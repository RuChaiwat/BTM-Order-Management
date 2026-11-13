import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'
import { cancelStalePackSessions, getPackMinDurationMinutes, getPackOrderLines, getPackingSettings, issueDeductPieces } from '@/lib/packing'

/**
 * Public, unauthenticated API behind the Pack Handheld (/handheld/pack) -- same trust model as
 * /api/handheld/picker-completions: packers have no login (they are rows in `pickers`), the
 * device's physical presence at a Pack Station is the boundary, and every request must name an
 * active Pack Station plus an active employee. Only these packing actions are exposed here;
 * nothing else in the app is reachable through it. Writes are credited to no login user
 * (changedBy/userId null) -- the packer's own ID is recorded on pack_sessions instead.
 *
 * GET  ?station=CODE                 -> validate the station (step 1)
 * GET  ?station=CODE&picker=ID       -> validate the employee for that station (step 2)
 * POST { action: 'scan_order', ... } -> start packing an order, or resume this packer's own open one
 * POST { action: 'finish', result }  -> 'completed' / 'completed_short' (after re-scanning the order; the
 *                                     packer enters nothing -- Admin Pack Verify itemizes the short)
 *                                     or 'issue' (problem lines picked from the order list on the timer
 *                                     screen, one per barcode with an optional comment; stops the timer
 *                                     at once, no minimum time)
 */

type Db = ReturnType<typeof createAdminClient>

function err(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status })
}

async function loadStation(db: Db, code: string | undefined | null) {
  const stationCode = code?.trim().toUpperCase()
  if (!stationCode) return { error: 'กรุณา scan Station · Station is required' }
  const { data: station } = await db.from('pack_stations').select('station_code, name, warehouse_code, active').eq('station_code', stationCode).maybeSingle()
  if (!station) return { error: `ไม่พบ Station "${stationCode}" · Unknown pack station` }
  if (!station.active) return { error: `Station ${station.station_code} ถูกปิดใช้งาน · Station is inactive` }
  return { station }
}

async function loadPicker(db: Db, raw: string | undefined | null, stationWarehouse: string | null) {
  const id = raw?.trim().toUpperCase()
  if (!id) return { error: 'กรุณา scan รหัสพนักงาน · Employee ID is required' }
  // Packers are the same people as Pickers: looked up in `pickers` (Picker & Packer Management) by
  // Picker ID, the only identifier since migration 0018 dropped the separate badge_code.
  const { data: picker, error } = await db.from('pickers').select('picker_id, name_en, name_th, active, warehouse_code').eq('picker_id', id).maybeSingle()
  if (error) return { error: `ค้นหารหัสพนักงานไม่สำเร็จ: ${error.message}` }
  if (!picker) return { error: `ไม่พบรหัสพนักงานแพ็ก ${id} · Unknown packer` }
  if (!picker.active) return { error: `${picker.name_th || picker.name_en} (${picker.picker_id}) ถูกปิดใช้งาน · Employee is inactive` }
  if (stationWarehouse && picker.warehouse_code && picker.warehouse_code !== stationWarehouse) {
    return { error: `${picker.name_th || picker.name_en} อยู่คลัง ${picker.warehouse_code} ไม่ใช่คลังของ Station นี้ (${stationWarehouse})` }
  }
  return { picker: { picker_id: picker.picker_id, name: picker.name_th || picker.name_en } }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const db = createAdminClient()
  const s = await loadStation(db, searchParams.get('station'))
  if (!s.station) return err(s.error!, 404)
  const station = { station_code: s.station.station_code, name: s.station.name }
  if (!searchParams.has('picker')) return NextResponse.json({ station })
  const p = await loadPicker(db, searchParams.get('picker'), s.station.warehouse_code)
  if (!p.picker) return err(p.error!, 404)
  return NextResponse.json({ station, picker: p.picker })
}

const PACK_STATUS_ERROR: Record<string, string> = {
  packed: 'order นี้แพ็กเสร็จแล้ว รอ Supervisor ยืนยัน · Already packed',
  confirmed: 'order นี้ยืนยันการแพ็กแล้ว · Pack already confirmed',
  issue: 'order นี้ถูกแจ้งปัญหา รอ Supervisor ตรวจสอบ · Issue under review',
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const db = createAdminClient()

  const s = await loadStation(db, body.station)
  if (!s.station) return err(s.error!, 404)
  const p = await loadPicker(db, body.picker, s.station.warehouse_code)
  if (!p.picker) return err(p.error!, 404)
  const station = s.station
  const picker = p.picker

  if (body.action === 'scan_order') return scanOrder(db, station, picker, String(body.order_no ?? ''))
  if (body.action === 'finish') return finish(db, picker, body)
  return err("action must be 'scan_order' or 'finish'")
}

async function scanOrder(db: Db, station: { station_code: string; warehouse_code: string | null }, picker: { picker_id: string; name: string }, rawOrderNo: string) {
  const orderNo = rawOrderNo.trim()
  if (!orderNo) return err('กรุณา scan เลข order · Order number is required')
  // No packing carries over to a new day: clear yesterday's open sessions before anything else.
  await cancelStalePackSessions(db)

  let q = db.from('orders').select('order_id, order_no, store_code, status, pack_status, warehouse_code, original_order_date').eq('order_no', orderNo)
  if (station.warehouse_code) q = q.eq('warehouse_code', station.warehouse_code)
  const { data: candidates } = await q.order('original_order_date', { ascending: false }).limit(10)
  if (!candidates || candidates.length === 0) return err(`ไม่พบ order "${orderNo}" · Order not found`, 404)
  // The same order number can recur on a later shipment date -- prefer the one actually in packing.
  const order = candidates.find((o) => o.pack_status === 'packing') ?? candidates.find((o) => o.pack_status === 'pending') ?? candidates[0]

  if (order.status === 'cancelled') return err('order นี้ถูกยกเลิกแล้ว · Order is cancelled', 409)
  if (!order.pack_status) {
    return order.status === 'final_closed_100' || order.status === 'final_closed_short'
      ? err('order นี้ verify ก่อนเปิดใช้ระบบแพ็ก จึงไม่อยู่ในคิวแพ็ก · Verified before packing went live', 409)
      : err(`order นี้ยังไม่ผ่าน Admin Verification (สถานะ: ${order.status}) · Not verified yet`, 409)
  }
  if (PACK_STATUS_ERROR[order.pack_status]) return err(PACK_STATUS_ERROR[order.pack_status], 409)

  const [minMinutes, bands, { lines, pieces }, { data: reasons }] = await Promise.all([
    getPackMinDurationMinutes(db),
    getPackingSettings(db),
    getPackOrderLines(db, order.order_id, { includeZero: true }),
    db.from('pack_issue_reasons').select('reason_code, label_en, label_th').eq('active', true).order('sort_order'),
  ])
  const orderOut = { order_id: order.order_id, order_no: order.order_no, store_code: order.store_code, pieces, lines, reasons: reasons ?? [] }

  // This packer's open session, if any (at most one -- unique index).
  const { data: mine } = await db.from('pack_sessions').select('session_id, order_id, started_at').eq('picker_id', picker.picker_id).is('finished_at', null).maybeSingle()

  if (order.pack_status === 'packing') {
    const { data: open } = await db.from('pack_sessions').select('session_id, picker_id, station_code, started_at').eq('order_id', order.order_id).is('finished_at', null).maybeSingle()
    if (open && open.picker_id === picker.picker_id) {
      return NextResponse.json({ session: { session_id: open.session_id, started_at: open.started_at }, order: orderOut, min_minutes: minMinutes, bands: { yellow: bands.yellowMinutes, red: bands.redMinutes }, server_now: new Date().toISOString(), resumed: true })
    }
    return err(open ? `order นี้กำลังแพ็กโดย ${open.picker_id} ที่ Station ${open.station_code} · Being packed by someone else` : 'order นี้กำลังแพ็กอยู่ · Already being packed', 409)
  }

  // pending
  if (mine) {
    const { data: other } = await db.from('orders').select('order_no').eq('order_id', mine.order_id).maybeSingle()
    return err(`คุณมีงานค้างอยู่: order ${other?.order_no ?? ''} — scan order นั้นเพื่อปิดงานก่อน · Finish your open order first`, 409)
  }

  const { data: session, error: insErr } = await db
    .from('pack_sessions')
    .insert({ order_id: order.order_id, picker_id: picker.picker_id, station_code: station.station_code, warehouse_code: order.warehouse_code, pieces })
    .select('session_id, started_at')
    .single()
  if (insErr || !session) return err('order นี้เพิ่งถูกเริ่มแพ็กจากอีกเครื่อง ลอง scan ใหม่ · Just started elsewhere, scan again', 409)

  const { data: flipped } = await db.from('orders').update({ pack_status: 'packing' }).eq('order_id', order.order_id).eq('pack_status', 'pending').select('order_id').maybeSingle()
  if (!flipped) {
    await db.from('pack_sessions').delete().eq('session_id', session.session_id)
    return err('สถานะ order เพิ่งเปลี่ยน ลอง scan ใหม่ · Order status just changed, scan again', 409)
  }

  await writeStatusHistory(db, { entityType: 'order_pack', entityId: order.order_id, oldStatus: 'pending', newStatus: 'packing', changedBy: null, reason: `${picker.picker_id} @ ${station.station_code}` })
  return NextResponse.json({ session, order: orderOut, min_minutes: minMinutes, bands: { yellow: bands.yellowMinutes, red: bands.redMinutes }, server_now: new Date().toISOString(), resumed: false }, { status: 201 })
}

interface IssueLineInput {
  line_id?: string | null
  /** scanned barcode of an item that is not in the TO (line_id empty) */
  barcode?: string
  /** older clients sent the not-in-TO code as sku */
  sku?: string
  reason_code?: string
  qty?: number
  remark?: string | null
}

async function finish(db: Db, picker: { picker_id: string; name: string }, body: { session_id?: string; result?: string; remark?: string; issue_lines?: IssueLineInput[] }) {
  const result = body.result
  if (!body.session_id || (result !== 'completed' && result !== 'completed_short' && result !== 'issue')) return err("session_id and result ('completed' | 'completed_short' | 'issue') are required")

  const { data: session } = await db.from('pack_sessions').select('session_id, order_id, picker_id, station_code, warehouse_code, started_at, finished_at, pieces').eq('session_id', body.session_id).maybeSingle()
  if (!session) return err('ไม่พบงานแพ็กนี้ · Packing session not found', 404)
  if (session.finished_at) return err('งานนี้ถูกปิดไปแล้ว · Already finished', 409)
  if (session.picker_id !== picker.picker_id) return err('งานนี้เป็นของพนักงานคนอื่น · Not your packing session', 403)

  const minMinutes = await getPackMinDurationMinutes(db)
  const elapsedMs = Date.now() - new Date(session.started_at).getTime()
  // A problem can be found the moment the box is opened, so reporting one is never held back.
  if (result !== 'issue' && elapsedMs < minMinutes * 60_000) {
    const left = Math.ceil((minMinutes * 60_000 - elapsedMs) / 1000)
    return err(`ยังไม่ครบเวลาขั้นต่ำ ${minMinutes} นาที — รออีก ${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} · Too soon to finish`, 409)
  }

  // Validate the problem lines before writing anything.
  let issueRows: { line_id: string | null; sku: string; barcode: string | null; item_description: string | null; bin_code: string | null; reason_code: string; qty: number; remark: string | null }[] = []
  let issuePieces = 0
  if (result === 'issue') {
    const input = Array.isArray(body.issue_lines) ? body.issue_lines : []
    if (input.length === 0) return err('ต้องระบุสินค้าที่มีปัญหาอย่างน้อย 1 รายการ · Add at least one problem item')
    const [{ data: lines }, { data: reasons }] = await Promise.all([
      db.from('order_lines').select('line_id, sku, sku_barcode, item_description, bin_code').eq('order_id', session.order_id),
      db.from('pack_issue_reasons').select('reason_code').eq('active', true),
    ])
    const lineById = new Map((lines ?? []).map((l) => [l.line_id, l]))
    const validReasons = new Set((reasons ?? []).map((r) => r.reason_code))
    const seen = new Set<string>()
    for (const [i, l] of input.entries()) {
      const n = i + 1
      const qty = Number(l.qty)
      const remark = typeof l.remark === 'string' ? l.remark.trim().slice(0, 500) || null : null
      if (!l.reason_code || !validReasons.has(l.reason_code)) return err(`รายการที่ ${n}: เลือกปัญหา · Choose a problem`)
      // No upper limit: สินค้าเกิน can be far more than was verified (client rule).
      if (!Number.isInteger(qty) || qty < 1) return err(`รายการที่ ${n}: จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป · Qty must be 1 or more`)
      if (l.line_id) {
        const line = lineById.get(l.line_id)
        if (!line) return err(`รายการที่ ${n}: สินค้านี้ไม่อยู่ใน order · Line not on this order`)
        if (seen.has(line.line_id)) return err(`รายการที่ ${n}: บาร์โค้ดซ้ำ · Duplicate item`)
        seen.add(line.line_id)
        issueRows.push({ line_id: line.line_id, sku: line.sku, barcode: line.sku_barcode, item_description: line.item_description, bin_code: line.bin_code, reason_code: l.reason_code, qty, remark })
      } else {
        const code = (l.barcode ?? l.sku ?? '').trim()
        if (!code) return err(`รายการที่ ${n}: scan บาร์โค้ดของสินค้าที่ไม่อยู่ใน TO · Barcode required`)
        if (seen.has(`x:${code.toUpperCase()}`)) return err(`รายการที่ ${n}: บาร์โค้ดซ้ำ · Duplicate item`)
        seen.add(`x:${code.toUpperCase()}`)
        issueRows.push({ line_id: null, sku: code, barcode: code, item_description: null, bin_code: null, reason_code: l.reason_code, qty, remark })
      }
    }
    const { lines: packLines } = await getPackOrderLines(db, session.order_id, { includeZero: true })
    issuePieces = issueDeductPieces(issueRows, new Map(packLines.map((l) => [l.line_id, l.qty])))
  }

  // Close the session first, guarded on still being open, so a double tap can't finish it twice.
  const { data: closed } = await db
    .from('pack_sessions')
    .update({ finished_at: new Date().toISOString(), result, issue_pieces: issuePieces })
    .eq('session_id', session.session_id)
    .is('finished_at', null)
    .select('session_id')
    .maybeSingle()
  if (!closed) return err('งานนี้ถูกปิดไปแล้ว · Already finished', 409)

  const newPackStatus = result === 'issue' ? 'issue' : 'packed'
  await db.from('orders').update({ pack_status: newPackStatus }).eq('order_id', session.order_id).eq('pack_status', 'packing')

  let issueId: string | null = null
  if (result === 'issue') {
    const { data: issue, error: issueErr } = await db
      .from('pack_issues')
      .insert({ order_id: session.order_id, session_id: session.session_id, picker_id: picker.picker_id, station_code: session.station_code, warehouse_code: session.warehouse_code, remark: body.remark?.trim() || null })
      .select('issue_id')
      .single()
    if (issueErr || !issue) return err(`บันทึกปัญหาไม่สำเร็จ: ${issueErr?.message ?? ''}`, 500)
    issueId = issue.issue_id
    const { error: linesErr } = await db.from('pack_issue_lines').insert(issueRows.map((r) => ({ issue_id: issue.issue_id, ...r })))
    if (linesErr) return err(`บันทึกรายการปัญหาไม่สำเร็จ: ${linesErr.message}`, 500)
  }

  await writeStatusHistory(db, { entityType: 'order_pack', entityId: session.order_id, oldStatus: 'packing', newStatus: newPackStatus, changedBy: null, reason: `${picker.picker_id} @ ${session.station_code}` })
  await writeAudit(db, {
    userId: null,
    action: `pack.${result}`,
    entityType: 'orders',
    entityId: session.order_id,
    after: { session_id: session.session_id, picker_id: picker.picker_id, station_code: session.station_code, elapsed_seconds: Math.round(elapsedMs / 1000), issue_id: issueId, issue_lines: issueRows },
  })

  return NextResponse.json({ pack_status: newPackStatus, elapsed_seconds: Math.round(elapsedMs / 1000) })
}
