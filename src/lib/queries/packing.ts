import type { SupabaseClient } from '@supabase/supabase-js'
import { bangkokDateKey, bangkokDayRange } from '../formatDate'
import { creditedPieces } from '../packing'

/* Read side of the Packing module (migration 0035) -- Live Packing Monitor, Packing Dashboard,
 * Packing Productivity, Pack Issue Investigation and Pack Issue Dashboard. Everything is scoped to
 * one warehouse. Large id lists are chunked so no PostgREST URL grows past its limit. */

const CHUNK = 150

async function inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data } = await fetchChunk(unique.slice(i, i + CHUNK))
    out.push(...(data ?? []))
  }
  return out
}

async function pickerNames(db: SupabaseClient, ids: string[]) {
  const rows = await inChunks<{ picker_id: string; name_en: string; name_th: string | null }>(ids, (c) => db.from('pickers').select('picker_id, name_en, name_th').in('picker_id', c))
  return new Map(rows.map((p) => [p.picker_id, p.name_th || p.name_en]))
}

async function userNames(db: SupabaseClient, ids: string[]) {
  const rows = await inChunks<{ user_id: string; name_en: string; name_th: string | null }>(ids, (c) => db.from('employees_users').select('user_id, name_en, name_th').in('user_id', c))
  return new Map(rows.map((u) => [u.user_id, u.name_th || u.name_en]))
}

function todayKey() {
  return bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------- Live Packing Monitor

export interface LiveSession {
  session_id: string
  station_code: string
  stationName: string
  picker_id: string
  pickerName: string
  order_no: string
  pieces: number
  started_at: string
  carriedOver: boolean
}

export async function getLiveMonitorData(db: SupabaseClient, warehouseCode: string) {
  const [{ data: sessions }, { data: stations }] = await Promise.all([
    db.from('pack_sessions').select('session_id, order_id, picker_id, station_code, started_at, pieces').eq('warehouse_code', warehouseCode).is('finished_at', null).order('started_at'),
    db.from('pack_stations').select('station_code, name, active, warehouse_code').eq('active', true).order('station_code'),
  ])
  const open = sessions ?? []
  const whStations = (stations ?? []).filter((s) => !s.warehouse_code || s.warehouse_code === warehouseCode)
  const stationName = new Map(whStations.map((s) => [s.station_code, s.name]))
  const orders = await inChunks<{ order_id: string; order_no: string }>(
    open.map((s) => s.order_id),
    (c) => db.from('orders').select('order_id, order_no').in('order_id', c),
  )
  const orderNo = new Map(orders.map((o) => [o.order_id, o.order_no]))
  const names = await pickerNames(
    db,
    open.map((s) => s.picker_id),
  )
  const today = todayKey()
  const live: LiveSession[] = open.map((s) => ({
    session_id: s.session_id,
    station_code: s.station_code,
    stationName: stationName.get(s.station_code) ?? '',
    picker_id: s.picker_id,
    pickerName: names.get(s.picker_id) ?? s.picker_id,
    order_no: orderNo.get(s.order_id) ?? '—',
    pieces: s.pieces,
    started_at: s.started_at,
    carriedOver: bangkokDateKey(s.started_at) !== today,
  }))
  const busyStations = new Set(live.map((s) => s.station_code))
  const idleStations = whStations.filter((s) => !busyStations.has(s.station_code)).map((s) => ({ station_code: s.station_code, name: s.name }))
  return { live, idleStations }
}

// ---------------------------------------------------------------- Packing Dashboard

const AGE_BUCKETS = [
  { label: '< 1 ชม.', max: 60 },
  { label: '1–2 ชม.', max: 120 },
  { label: '2–4 ชม.', max: 240 },
  { label: '4–8 ชม.', max: 480 },
  { label: '> 8 ชม.', max: Infinity },
]

export async function getPackingDashboardData(db: SupabaseClient, warehouseCode: string) {
  const count = (status: string) => db.from('orders').select('order_id', { count: 'exact', head: true }).eq('warehouse_code', warehouseCode).eq('pack_status', status)
  const { sinceIso, untilIso } = bangkokDayRange(todayKey())
  const [pending, packing, packed, issue, openIssues, pendingAges, todaySessions, confirmedToday] = await Promise.all([
    count('pending'),
    count('packing'),
    count('packed'),
    count('issue'),
    db.from('pack_issues').select('issue_id', { count: 'exact', head: true }).eq('warehouse_code', warehouseCode).in('status', ['open', 'investigating']),
    db.from('orders').select('pack_ready_at').eq('warehouse_code', warehouseCode).eq('pack_status', 'pending').limit(10000),
    db.from('pack_sessions').select('picker_id, finished_at, result, pieces, issue_pieces, short_pieces').eq('warehouse_code', warehouseCode).gte('finished_at', sinceIso).lt('finished_at', untilIso).neq('result', 'cancelled').limit(20000),
    db.from('pack_verifications').select('order_id', { count: 'exact', head: true }).gte('verified_time', sinceIso).lt('verified_time', untilIso),
  ])

  const now = Date.now()
  const aging = AGE_BUCKETS.map((b) => ({ label: b.label, count: 0 }))
  let oldestMinutes = 0
  for (const o of pendingAges.data ?? []) {
    const mins = o.pack_ready_at ? (now - new Date(o.pack_ready_at).getTime()) / 60000 : 0
    oldestMinutes = Math.max(oldestMinutes, mins)
    aging[AGE_BUCKETS.findIndex((b) => mins < b.max)].count++
  }

  const hourly = Array.from({ length: 24 }, (_, h) => ({ hour: h, pieces: 0, orders: 0 }))
  let piecesToday = 0
  const packers = new Set<string>()
  for (const s of todaySessions.data ?? []) {
    const h = Number(new Date(s.finished_at!).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).slice(0, 2)) % 24
    const pcs = creditedPieces(s)
    hourly[h].pieces += pcs
    hourly[h].orders++
    piecesToday += pcs
    packers.add(s.picker_id)
  }

  return {
    counts: { pending: pending.count ?? 0, packing: packing.count ?? 0, packed: packed.count ?? 0, issue: issue.count ?? 0, openIssues: openIssues.count ?? 0 },
    today: { orders: (todaySessions.data ?? []).length, pieces: piecesToday, packers: packers.size, confirmed: confirmedToday.count ?? 0 },
    aging,
    oldestMinutes: Math.round(oldestMinutes),
    hourly,
  }
}

// ---------------------------------------------------------------- Packing Productivity

export interface PackerProductivityRow {
  picker_id: string
  name: string
  orders: number
  pieces: number
  seconds: number
  pcsPerHour: number | null
  avgSecondsPerOrder: number | null
  issuesReported: number
  issuePieces: number
  stations: string[]
}

export async function getPackingProductivity(db: SupabaseClient, warehouseCode: string, dateKey: string) {
  const { sinceIso, untilIso } = bangkokDayRange(dateKey)
  const { data } = await db
    .from('pack_sessions')
    .select('picker_id, station_code, started_at, finished_at, result, pieces, issue_pieces, short_pieces')
    .eq('warehouse_code', warehouseCode)
    .gte('finished_at', sinceIso)
    .lt('finished_at', untilIso)
    .neq('result', 'cancelled')
    .limit(20000)
  const sessions = data ?? []
  const names = await pickerNames(
    db,
    sessions.map((s) => s.picker_id),
  )

  type Acc = { orders: number; pieces: number; seconds: number; issues: number; issuePieces: number; stations: Set<string> }
  const blank = (): Acc => ({ orders: 0, pieces: 0, seconds: 0, issues: 0, issuePieces: 0, stations: new Set() })
  const byPacker = new Map<string, Acc>()
  const byStation = new Map<string, Acc>()
  const hourly = Array.from({ length: 24 }, () => ({ orders: 0, pieces: 0 }))
  const total = blank()
  for (const s of sessions) {
    const secs = Math.max(0, (new Date(s.finished_at!).getTime() - new Date(s.started_at).getTime()) / 1000)
    const pcs = creditedPieces(s)
    for (const acc of [
      byPacker.get(s.picker_id) ?? byPacker.set(s.picker_id, blank()).get(s.picker_id)!,
      byStation.get(s.station_code) ?? byStation.set(s.station_code, blank()).get(s.station_code)!,
      total,
    ]) {
      acc.orders++
      acc.pieces += pcs
      acc.seconds += secs
      acc.stations.add(s.station_code)
      if (s.result === 'issue') {
        acc.issues++
        acc.issuePieces += Number(s.issue_pieces)
      }
    }
    const h = Number(new Date(s.finished_at!).toLocaleString('en-GB', { timeZone: 'Asia/Bangkok', hour: '2-digit', hour12: false }).slice(0, 2)) % 24
    hourly[h].orders++
    hourly[h].pieces += pcs
  }
  const rate = (a: Acc) => (a.seconds > 0 ? Math.round((a.pieces / a.seconds) * 3600) : null)
  const packers: PackerProductivityRow[] = [...byPacker.entries()]
    .map(([id, a]) => ({
      picker_id: id,
      name: names.get(id) ?? id,
      orders: a.orders,
      pieces: a.pieces,
      seconds: Math.round(a.seconds),
      pcsPerHour: rate(a),
      avgSecondsPerOrder: a.orders ? Math.round(a.seconds / a.orders) : null,
      issuesReported: a.issues,
      issuePieces: a.issuePieces,
      stations: [...a.stations].sort(),
    }))
    .sort((a, b) => (b.pcsPerHour ?? -1) - (a.pcsPerHour ?? -1))
  const stations = [...byStation.entries()]
    .map(([code, a]) => ({ station_code: code, orders: a.orders, pieces: a.pieces, seconds: Math.round(a.seconds), pcsPerHour: rate(a), issuesReported: a.issues }))
    .sort((a, b) => a.station_code.localeCompare(b.station_code))
  return {
    packers,
    stations,
    hourly: hourly.map((h, i) => ({ hour: i, ...h })),
    totals: { orders: total.orders, pieces: total.pieces, seconds: Math.round(total.seconds), pcsPerHour: rate(total), issues: total.issues, issuePieces: total.issuePieces, packers: byPacker.size },
  }
}

// ---------------------------------------------------------------- Pack issues

export interface PackIssueListItem {
  issue_id: string
  order_no: string
  station_code: string | null
  packerName: string
  status: 'open' | 'investigating' | 'resolved'
  reported_at: string
  reasons: string[]
  pieces: number
  acknowledgedBy: string | null
}

export async function getReasonLabels(db: SupabaseClient) {
  const { data } = await db.from('pack_issue_reasons').select('reason_code, label_en, label_th, active').order('sort_order')
  return data ?? []
}

/** Inbox list: every unresolved issue, plus resolved ones reported on/after `resolvedSince`. */
export async function getPackIssueList(db: SupabaseClient, warehouseCode: string, resolvedSinceIso: string): Promise<PackIssueListItem[]> {
  const [{ data: openRows }, { data: resolvedRows }] = await Promise.all([
    db.from('pack_issues').select('issue_id, order_id, station_code, picker_id, status, reported_at, acknowledged_by').eq('warehouse_code', warehouseCode).in('status', ['open', 'investigating']).order('reported_at', { ascending: false }).limit(1000),
    db.from('pack_issues').select('issue_id, order_id, station_code, picker_id, status, reported_at, acknowledged_by').eq('warehouse_code', warehouseCode).eq('status', 'resolved').gte('reported_at', resolvedSinceIso).order('reported_at', { ascending: false }).limit(1000),
  ])
  const issues = [...(openRows ?? []), ...(resolvedRows ?? [])]
  const [orders, lines, reasons, packers, users] = await Promise.all([
    inChunks<{ order_id: string; order_no: string }>(
      issues.map((i) => i.order_id),
      (c) => db.from('orders').select('order_id, order_no').in('order_id', c),
    ),
    inChunks<{ issue_id: string; reason_code: string; qty: number }>(
      issues.map((i) => i.issue_id),
      (c) => db.from('pack_issue_lines').select('issue_id, reason_code, qty').in('issue_id', c),
    ),
    getReasonLabels(db),
    pickerNames(
      db,
      issues.map((i) => i.picker_id ?? ''),
    ),
    userNames(
      db,
      issues.map((i) => i.acknowledged_by ?? ''),
    ),
  ])
  const orderNo = new Map(orders.map((o) => [o.order_id, o.order_no]))
  const label = new Map(reasons.map((r) => [r.reason_code, r.label_th || r.label_en]))
  const linesByIssue = new Map<string, { reason_code: string; qty: number }[]>()
  for (const l of lines) linesByIssue.set(l.issue_id, [...(linesByIssue.get(l.issue_id) ?? []), l])
  return issues.map((i) => {
    const ls = linesByIssue.get(i.issue_id) ?? []
    return {
      issue_id: i.issue_id,
      order_no: orderNo.get(i.order_id) ?? '—',
      station_code: i.station_code,
      packerName: i.picker_id ? names(packers, i.picker_id) : '—',
      status: i.status,
      reported_at: i.reported_at,
      reasons: [...new Set(ls.map((l) => label.get(l.reason_code) ?? l.reason_code))],
      pieces: ls.reduce((s, l) => s + Number(l.qty), 0),
      acknowledgedBy: i.acknowledged_by ? names(users, i.acknowledged_by) : null,
    }
  })
}

function names(map: Map<string, string>, id: string) {
  return map.get(id) ?? id
}

/** Everything the Investigation detail panel shows for one issue: what was reported, the order's
 * full Pick history (who picked, from which bin/zone, who verified) and every pack attempt. */
export async function getPackIssueDetail(db: SupabaseClient, issueId: string) {
  const { data: issue } = await db.from('pack_issues').select('*').eq('issue_id', issueId).maybeSingle()
  if (!issue) return null
  const orderId = issue.order_id as string

  const [{ data: order }, { data: issueLines }, reasons, { data: orderLines }, { data: completion }, { data: verifications }, { data: sessions }, { data: station }] = await Promise.all([
    db.from('orders').select('order_id, order_no, store_code, status, pack_status, assignment_batch_id, original_order_date').eq('order_id', orderId).maybeSingle(),
    db.from('pack_issue_lines').select('id, line_id, sku, item_description, bin_code, reason_code, qty').eq('issue_id', issueId),
    getReasonLabels(db),
    db.from('order_lines').select('line_id, sku, sku_barcode, item_description, bin_code, zone_code, qty').eq('order_id', orderId).order('pick_sequence'),
    db.from('picker_completions').select('completion_id, picker_completed_time, actual_pieces, result').eq('order_id', orderId).maybeSingle(),
    db.from('admin_verifications').select('admin_id, decision, verified_time, reject_reason').eq('order_id', orderId).order('verified_time'),
    db.from('pack_sessions').select('session_id, picker_id, station_code, started_at, finished_at, result, pieces, issue_pieces, cancel_reason, cancelled_by').eq('order_id', orderId).order('started_at'),
    issue.station_code ? db.from('pack_stations').select('name').eq('station_code', issue.station_code).maybeSingle() : Promise.resolve({ data: null }),
  ])

  const { data: batch } = order?.assignment_batch_id
    ? await db.from('assignment_batches').select('picker_id, admin_id, assigned_time, zone_code').eq('assignment_batch_id', order.assignment_batch_id).maybeSingle()
    : { data: null }
  const { data: completionLines } = completion
    ? await db.from('picker_completion_lines').select('line_id, picked_qty, is_short, short_reason_code').eq('completion_id', completion.completion_id)
    : { data: [] as { line_id: string; picked_qty: number; is_short: boolean; short_reason_code: string | null }[] }

  const pickerIds = [issue.picker_id, batch?.picker_id, ...(sessions ?? []).map((s) => s.picker_id)].filter(Boolean) as string[]
  const userIds = [issue.acknowledged_by, issue.resolved_by, batch?.admin_id, ...(verifications ?? []).map((v) => v.admin_id), ...(sessions ?? []).map((s) => s.cancelled_by)].filter(Boolean) as string[]
  const [pNames, uNames] = await Promise.all([pickerNames(db, pickerIds), userNames(db, userIds)])
  const label = new Map(reasons.map((r) => [r.reason_code, r.label_th || r.label_en]))
  const picked = new Map((completionLines ?? []).map((c) => [c.line_id, c]))
  const lineById = new Map((orderLines ?? []).map((l) => [l.line_id, l]))
  const flaggedLineIds = new Set((issueLines ?? []).map((l) => l.line_id).filter(Boolean))

  return {
    issue: {
      ...issue,
      packerName: issue.picker_id ? names(pNames, issue.picker_id) : '—',
      stationName: station?.name ?? '',
      acknowledgedByName: issue.acknowledged_by ? names(uNames, issue.acknowledged_by) : null,
      resolvedByName: issue.resolved_by ? names(uNames, issue.resolved_by) : null,
    },
    // Packers and supervisors work from the barcode printed on the product, not the internal SKU.
    issueLines: (issueLines ?? []).map((l) => {
      const ol = l.line_id ? lineById.get(l.line_id) : undefined
      return { ...l, barcode: ol ? ol.sku_barcode || `SKU ${ol.sku}` : l.sku, reasonLabel: label.get(l.reason_code) ?? l.reason_code }
    }),
    order,
    pick: {
      pickerId: batch?.picker_id ?? null,
      pickerName: batch?.picker_id ? names(pNames, batch.picker_id) : null,
      assignedBy: batch?.admin_id ? names(uNames, batch.admin_id) : null,
      assignedTime: batch?.assigned_time ?? null,
      zone: batch?.zone_code ?? null,
      completedTime: completion?.picker_completed_time ?? null,
      result: completion?.result ?? null,
      verifications: (verifications ?? []).map((v) => ({ ...v, adminName: v.admin_id ? names(uNames, v.admin_id) : '—' })),
      lines: (orderLines ?? []).map((l) => {
        const c = picked.get(l.line_id)
        return { ...l, picked_qty: c ? Number(c.picked_qty) : null, short_reason_code: c?.short_reason_code ?? null, flagged: flaggedLineIds.has(l.line_id) }
      }),
    },
    packSessions: (sessions ?? []).map((s) => ({ ...s, pickerName: names(pNames, s.picker_id), cancelledByName: s.cancelled_by ? names(uNames, s.cancelled_by) : null })),
  }
}

// ---------------------------------------------------------------- Pack Issue Dashboard

export async function getPackIssueDashboard(db: SupabaseClient, warehouseCode: string, fromKey: string, toKey: string) {
  const sinceIso = bangkokDayRange(fromKey).sinceIso
  const untilIso = bangkokDayRange(toKey).untilIso
  const [{ data: issueRows }, { count: sessionCount }] = await Promise.all([
    db.from('pack_issues').select('issue_id, order_id, station_code, status, reported_at, resolved_at, root_cause').eq('warehouse_code', warehouseCode).gte('reported_at', sinceIso).lt('reported_at', untilIso).limit(20000),
    db.from('pack_sessions').select('session_id', { count: 'exact', head: true }).eq('warehouse_code', warehouseCode).gte('finished_at', sinceIso).lt('finished_at', untilIso).neq('result', 'cancelled'),
  ])
  const issues = issueRows ?? []
  const [lines, reasons, orders] = await Promise.all([
    inChunks<{ issue_id: string; line_id: string | null; reason_code: string; qty: number }>(
      issues.map((i) => i.issue_id),
      (c) => db.from('pack_issue_lines').select('issue_id, line_id, reason_code, qty').in('issue_id', c),
    ),
    getReasonLabels(db),
    inChunks<{ order_id: string; assignment_batch_id: string | null }>(
      issues.map((i) => i.order_id),
      (c) => db.from('orders').select('order_id, assignment_batch_id').in('order_id', c),
    ),
  ])
  const [batches, orderLines] = await Promise.all([
    inChunks<{ assignment_batch_id: string; picker_id: string | null }>(
      orders.map((o) => o.assignment_batch_id ?? ''),
      (c) => db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', c),
    ),
    inChunks<{ line_id: string; zone_code: string | null }>(
      lines.map((l) => l.line_id ?? ''),
      (c) => db.from('order_lines').select('line_id, zone_code').in('line_id', c),
    ),
  ])
  const pNames = await pickerNames(
    db,
    batches.map((b) => b.picker_id ?? ''),
  )
  const label = new Map(reasons.map((r) => [r.reason_code, r.label_th || r.label_en]))
  const batchOfOrder = new Map(orders.map((o) => [o.order_id, o.assignment_batch_id]))
  const pickerOfBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))
  const zoneOfLine = new Map(orderLines.map((l) => [l.line_id, l.zone_code]))

  const tally = () => new Map<string, { count: number; pieces: number }>()
  const add = (m: Map<string, { count: number; pieces: number }>, key: string, pcs: number, countIt = true) => {
    const cur = m.get(key) ?? { count: 0, pieces: 0 }
    if (countIt) cur.count++
    cur.pieces += pcs
    m.set(key, cur)
  }
  const byReason = tally()
  const byStation = tally()
  const byPicker = tally()
  const byZone = tally()
  const byRootCause = tally()
  const byDay = new Map<string, number>()
  let totalPieces = 0
  const issuePiecesById = new Map<string, number>()
  for (const l of lines) {
    const qty = Number(l.qty)
    totalPieces += qty
    issuePiecesById.set(l.issue_id, (issuePiecesById.get(l.issue_id) ?? 0) + qty)
    add(byReason, label.get(l.reason_code) ?? l.reason_code, qty)
    add(byZone, l.line_id ? zoneOfLine.get(l.line_id) ?? 'ไม่ระบุ' : 'ไม่อยู่ใน TO', qty)
  }
  let resolvedCount = 0
  let resolveMinutes = 0
  for (const i of issues) {
    const pcs = issuePiecesById.get(i.issue_id) ?? 0
    add(byStation, i.station_code ?? '—', pcs)
    const batchId = batchOfOrder.get(i.order_id)
    const pickerId = batchId ? pickerOfBatch.get(batchId) : null
    add(byPicker, pickerId ? `${pNames.get(pickerId) ?? pickerId} (${pickerId})` : 'ไม่ระบุ', pcs)
    if (i.root_cause) add(byRootCause, i.root_cause, pcs)
    const day = bangkokDateKey(i.reported_at) ?? ''
    byDay.set(day, (byDay.get(day) ?? 0) + 1)
    if (i.status === 'resolved' && i.resolved_at) {
      resolvedCount++
      resolveMinutes += (new Date(i.resolved_at).getTime() - new Date(i.reported_at).getTime()) / 60000
    }
  }
  const sorted = (m: Map<string, { count: number; pieces: number }>) => [...m.entries()].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.count - a.count || b.pieces - a.pieces)

  const days: { day: string; count: number }[] = []
  for (let d = new Date(`${fromKey}T00:00:00+07:00`); bangkokDateKey(d)! <= toKey; d = new Date(d.getTime() + 86400000)) {
    const k = bangkokDateKey(d)!
    days.push({ day: k, count: byDay.get(k) ?? 0 })
    if (days.length > 120) break
  }

  return {
    kpis: {
      issues: issues.length,
      pieces: totalPieces,
      open: issues.filter((i) => i.status !== 'resolved').length,
      avgResolveMinutes: resolvedCount ? Math.round(resolveMinutes / resolvedCount) : null,
      issueRatePct: sessionCount ? Math.round((issues.length / sessionCount) * 1000) / 10 : null,
      packedOrders: sessionCount ?? 0,
    },
    byReason: sorted(byReason),
    byStation: sorted(byStation),
    byPicker: sorted(byPicker).slice(0, 15),
    byZone: sorted(byZone),
    byRootCause: sorted(byRootCause),
    days,
  }
}

// ---------------------------------------------------------------- Pack queue (orders waiting to pack)

export interface PackQueueRow {
  order_id: string
  order_no: string
  store_code: string
  order_date: string
  pick_status: string
  pieces: number
  skus: number
  pack_ready_at: string | null
  waitMinutes: number
}

/** Every order waiting to be packed (pack_status = 'pending') in this warehouse, longest-waiting
 * first. Pieces are Admin Verification's verified pieces (what will actually be packed). */
export async function getPackQueue(db: SupabaseClient, warehouseCode: string): Promise<PackQueueRow[]> {
  const { data, error } = await db
    .from('orders')
    .select('order_id, order_no, store_code, original_order_date, status, planned_pieces, unique_sku_count, pack_ready_at')
    .eq('warehouse_code', warehouseCode)
    .eq('pack_status', 'pending')
    .order('pack_ready_at', { ascending: true })
    .limit(10000)
  if (error) throw new Error(error.message)
  const orders = data ?? []
  const completions = await inChunks<{ order_id: string; actual_pieces: number | null }>(
    orders.map((o) => o.order_id),
    (c) => db.from('picker_completions').select('order_id, actual_pieces').in('order_id', c),
  )
  const pcs = new Map(completions.map((c) => [c.order_id, c.actual_pieces]))
  const now = Date.now()
  return orders.map((o) => ({
    order_id: o.order_id,
    order_no: o.order_no,
    store_code: o.store_code,
    order_date: o.original_order_date,
    pick_status: o.status,
    pieces: Number(pcs.get(o.order_id) ?? o.planned_pieces),
    skus: o.unique_sku_count,
    pack_ready_at: o.pack_ready_at,
    waitMinutes: o.pack_ready_at ? Math.max(0, Math.round((now - new Date(o.pack_ready_at).getTime()) / 60000)) : 0,
  }))
}
