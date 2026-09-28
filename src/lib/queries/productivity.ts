import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds } from './scopedFetch'

const WINDOW_DAYS = 7
/** Cycle time (Assigned → Picker Completed) at or under this is "on time" for the SLA KPI here.
 * Matches Control Tower's "overdue" threshold (§13); a dedicated configuration key is a
 * reasonable follow-up, not built here (same judgment call as order_alerts' thresholds). */
const SLA_THRESHOLD_MINUTES = 120

/** §12.2/§13 Productivity / SLA / Short Pick analytics — 7-day picker productivity, cycle-time
 * SLA compliance, and a short-pick reason breakdown (which reasons/zones cost the most pieces).
 *
 * "Completed" here means the same thing it means everywhere else in this app (Operations
 * Dashboard, Control Tower): a decision='final_close' admin_verifications row, not the picker's
 * own coarse self-report -- picker_completion_lines (and therefore any short-pick reason detail)
 * is only ever written at that step (app/api/admin-verifications/route.ts), and
 * picker_completions.actual_pieces/result get corrected to the real verified numbers there too.
 * Windowed to the last WINDOW_DAYS by verified_time, so this reads as "throughput this week"
 * rather than the dashboards' all-time cumulative count -- the two are related but not meant to
 * be identical. */
export async function getProductivityData(db: SupabaseClient, warehouseCode: string) {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [orders, pickers] = await Promise.all([
    fetchAllRows((from, to) => db.from('orders').select('order_id, assigned_time, assignment_batch_id').eq('warehouse_code', warehouseCode).range(from, to)),
    db.from('pickers').select('picker_id, name_en').eq('warehouse_code', warehouseCode).eq('active', true).then(unwrap),
  ])
  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const orderIds = orders.map((o) => o.order_id)

  // admin_verifications/picker_completions have no warehouse_code column, so both are fetched via
  // an RPC scoped to exactly this warehouse's order_ids (same pattern as dashboard.ts/backlog.ts),
  // then windowed by verified_time/picker_completed_time in JS.
  const [verifications, completions] = await Promise.all([
    fetchScopedByOrderIds<{ order_id: string; decision: string; verified_time: string }>(db, 'get_admin_verifications_by_ids', 'order_id, decision, verified_time', orderIds),
    fetchScopedByOrderIds<{ completion_id: string; order_id: string; actual_pieces: number | null; result: string; picker_completed_time: string }>(
      db,
      'get_picker_completions_by_ids',
      'completion_id, order_id, actual_pieces, result, picker_completed_time',
      orderIds,
    ),
  ])
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))

  const completedOrderIds = new Set(verifications.filter((v) => v.decision === 'final_close' && v.verified_time >= sinceIso).map((v) => v.order_id))
  const completedRows = [...completedOrderIds]
    .map((orderId) => ({ order: orderById.get(orderId), completion: completionByOrderId.get(orderId) }))
    .filter((r): r is { order: NonNullable<typeof r.order>; completion: NonNullable<typeof r.completion> } => !!r.order && !!r.completion)

  const batchIds = [...new Set(completedRows.map((r) => r.order.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))

  const productivityByPicker = new Map<string, { pieces: number; minutes: number; completed: number; short: number; onTime: number }>()
  let totalPieces = 0
  let totalMinutes = 0
  let onTimeCount = 0
  let cycleTimedCount = 0
  let shortCount = 0

  for (const { order, completion } of completedRows) {
    const pickerId = order.assignment_batch_id ? pickerIdByBatch.get(order.assignment_batch_id) : null
    totalPieces += completion.actual_pieces ?? 0
    if (completion.result === 'short') shortCount += 1
    if (!order.assigned_time) continue
    const minutes = Math.max(1, (new Date(completion.picker_completed_time).getTime() - new Date(order.assigned_time).getTime()) / 60000)
    totalMinutes += minutes
    cycleTimedCount += 1
    const onTime = minutes <= SLA_THRESHOLD_MINUTES
    if (onTime) onTimeCount += 1
    if (!pickerId) continue
    const entry = productivityByPicker.get(pickerId) ?? { pieces: 0, minutes: 0, completed: 0, short: 0, onTime: 0 }
    entry.pieces += completion.actual_pieces ?? 0
    entry.minutes += minutes
    entry.completed += 1
    if (completion.result === 'short') entry.short += 1
    if (onTime) entry.onTime += 1
    productivityByPicker.set(pickerId, entry)
  }

  const pickerRows = pickers.map((p) => {
    const e = productivityByPicker.get(p.picker_id)
    return {
      user_id: p.picker_id,
      name: p.name_en,
      pcsPerHour: e && e.minutes > 0 ? Math.round((e.pieces / e.minutes) * 60) : null,
      completed: e?.completed ?? 0,
      shortRate: e && e.completed > 0 ? Math.round((e.short / e.completed) * 1000) / 10 : null,
      slaPct: e && e.completed > 0 ? Math.round((e.onTime / e.completed) * 1000) / 10 : null,
    }
  })

  const completionIds = completedRows.map((r) => r.completion.completion_id)
  const shortLinesRes = completionIds.length
    ? await db.from('picker_completion_lines').select('line_id, short_reason_code, ordered_qty, picked_qty').in('completion_id', completionIds).eq('is_short', true)
    : { data: [] as { line_id: string; short_reason_code: string | null; ordered_qty: number; picked_qty: number }[] }
  const shortLines = unwrap(shortLinesRes)

  const lineIds = shortLines.map((l) => l.line_id)
  const orderLinesRes = lineIds.length ? await db.from('order_lines').select('line_id, zone_code').in('line_id', lineIds) : { data: [] as { line_id: string; zone_code: string | null }[] }
  const zoneByLine = new Map(unwrap(orderLinesRes).map((l) => [l.line_id, l.zone_code]))

  const reasonsRes = await db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick')
  const labelByReason = new Map(unwrap(reasonsRes).map((r) => [r.reason_code, r.label_en]))

  const reasonTotals = new Map<string, { code: string; zone: string; count: number; shortPieces: number }>()
  for (const l of shortLines) {
    const code = l.short_reason_code ?? 'UNKNOWN'
    const zone = zoneByLine.get(l.line_id) ?? '—'
    const key = `${code}__${zone}`
    const entry = reasonTotals.get(key) ?? { code, zone, count: 0, shortPieces: 0 }
    entry.count += 1
    entry.shortPieces += Number(l.ordered_qty) - Number(l.picked_qty)
    reasonTotals.set(key, entry)
  }
  const reasonBreakdown = [...reasonTotals.values()]
    .map((t) => ({ code: t.code, label: labelByReason.get(t.code) ?? t.code, zone: t.zone, count: t.count, shortPieces: t.shortPieces }))
    .sort((a, b) => b.shortPieces - a.shortPieces)

  return {
    windowDays: WINDOW_DAYS,
    pickerRows,
    reasonBreakdown,
    kpis: {
      completedOrders: completedRows.length,
      totalPieces,
      avgPcsPerHour: totalMinutes > 0 ? Math.round((totalPieces / totalMinutes) * 60) : null,
      slaPct: cycleTimedCount > 0 ? Math.round((onTimeCount / cycleTimedCount) * 1000) / 10 : null,
      shortRatePct: completedRows.length > 0 ? Math.round((shortCount / completedRows.length) * 1000) / 10 : null,
    },
  }
}
