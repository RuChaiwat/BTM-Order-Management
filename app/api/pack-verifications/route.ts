import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'
import { getPackOrderLines } from '@/lib/packing'

const PACK_ADMIN_ROLES = ['system_admin', 'pack_supervisor']

type Db = ReturnType<typeof createAdminClient>

/** Lines of one packed order + the Short Pick reasons, for the detail panel of Admin Pack Verify. */
export async function GET(request: Request) {
  try {
    await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const orderId = new URL(request.url).searchParams.get('order_id')
  if (!orderId) return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
  const admin = createAdminClient()
  const [{ lines, pieces }, { data: reasons }] = await Promise.all([
    getPackOrderLines(admin, orderId),
    admin.from('reason_master').select('reason_code, label_en, label_th').eq('reason_type', 'short_pick').eq('active', true).order('reason_code'),
  ])
  return NextResponse.json({ lines, pieces, reasons: reasons ?? [] }, { headers: { 'Cache-Control': 'no-store' } })
}

interface LineInput {
  line_id: string
  packed_qty: number
  short_reason_code?: string | null
  remark?: string | null
}

async function latestSession(db: Db, orderId: string) {
  const { data } = await db.from('pack_sessions').select('session_id, result').eq('order_id', orderId).not('finished_at', 'is', null).neq('result', 'cancelled').order('finished_at', { ascending: false }).limit(1).maybeSingle()
  return data
}

/**
 * Admin Pack Verify -- the Pack Supervisor confirms in WMS, then here. Same shape as Admin
 * Verification on the Pick side:
 *   { order_id, lines }  one order, every line itemized: packed qty, and for a short line the Short
 *                        Pick reason (reason_master, same list as the Pick side). Required for an
 *                        order the packer finished with Completed with Short.
 *   { order_ids }        bulk confirm of orders packed in full -- an order finished with Completed
 *                        with Short is refused here and must be opened on its own.
 * No reject (client decision). Each order is guarded on still being 'packed' (compare-and-swap).
 * Short pieces are written to the order's latest pack session so the packer's productivity
 * excludes them.
 */
export async function POST(request: Request) {
  let caller: Awaited<ReturnType<typeof requireRole>>
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const warehouseCode = caller.warehouse_code
  const body = (await request.json()) as { order_ids?: string[]; order_id?: string; lines?: LineInput[] }
  const admin = createAdminClient()

  async function flip(orderId: string) {
    let q = admin.from('orders').update({ pack_status: 'confirmed' }).eq('order_id', orderId).eq('pack_status', 'packed')
    if (warehouseCode) q = q.eq('warehouse_code', warehouseCode)
    const { data } = await q.select('order_id, order_no').maybeSingle()
    return data
  }

  // ---- one order, itemized
  if (body.order_id) {
    const orderId = body.order_id
    const input = Array.isArray(body.lines) ? body.lines : []
    const { lines: expected } = await getPackOrderLines(admin, orderId)
    if (expected.length === 0) return NextResponse.json({ error: 'Order has no lines to verify' }, { status: 409 })
    const expectedById = new Map(expected.map((l) => [l.line_id, l.qty]))
    const { data: reasons } = await admin.from('reason_master').select('reason_code').eq('reason_type', 'short_pick').eq('active', true)
    const validReasons = new Set((reasons ?? []).map((r) => r.reason_code))

    const rows: { line_id: string; expected_qty: number; packed_qty: number; is_short: boolean; short_reason_code: string | null; remark: string | null }[] = []
    for (const l of input) {
      const exp = expectedById.get(l.line_id)
      if (exp === undefined) return NextResponse.json({ error: `Line ${l.line_id} is not on this order` }, { status: 400 })
      const packed = Number(l.packed_qty)
      if (!Number.isFinite(packed) || packed < 0 || packed > exp) return NextResponse.json({ error: `จำนวนที่แพ็กต้องอยู่ระหว่าง 0 ถึง ${exp}` }, { status: 400 })
      const isShort = packed < exp
      if (isShort && (!l.short_reason_code || !validReasons.has(l.short_reason_code))) return NextResponse.json({ error: 'ต้องเลือกเหตุผลของรายการที่ขาด · A short reason is required' }, { status: 400 })
      rows.push({ line_id: l.line_id, expected_qty: exp, packed_qty: packed, is_short: isShort, short_reason_code: isShort ? l.short_reason_code! : null, remark: isShort ? l.remark?.trim() || null : null })
    }
    if (rows.length !== expected.length || new Set(rows.map((r) => r.line_id)).size !== expected.length) {
      return NextResponse.json({ error: 'ต้องระบุผลครบทุกรายการ · Every line must be itemized' }, { status: 400 })
    }

    const order = await flip(orderId)
    if (!order) return NextResponse.json({ error: 'order นี้ถูกยืนยันไปแล้ว หรือสถานะเปลี่ยน · Already confirmed or status changed' }, { status: 409 })
    const { data: ver, error: verErr } = await admin.from('pack_verifications').insert({ order_id: orderId, admin_id: caller.user_id }).select('verification_id').single()
    if (verErr || !ver) return NextResponse.json({ error: verErr?.message ?? 'Could not record verification' }, { status: 500 })
    const { error: linesErr } = await admin.from('pack_verification_lines').insert(rows.map((r) => ({ verification_id: ver.verification_id, ...r })))
    if (linesErr) return NextResponse.json({ error: linesErr.message }, { status: 500 })

    const shortPieces = Math.round(rows.reduce((s, r) => s + (r.expected_qty - r.packed_qty), 0))
    const session = await latestSession(admin, orderId)
    if (session) await admin.from('pack_sessions').update({ short_pieces: shortPieces }).eq('session_id', session.session_id)

    await writeStatusHistory(admin, { entityType: 'order_pack', entityId: orderId, oldStatus: 'packed', newStatus: 'confirmed', changedBy: caller.user_id, reason: shortPieces ? `short ${shortPieces} pcs` : null })
    await writeAudit(admin, { userId: caller.user_id, action: 'pack_verification.confirm', entityType: 'orders', entityId: orderId, after: { order_no: order.order_no, short_pieces: shortPieces, lines: rows.filter((r) => r.is_short) } })
    return NextResponse.json({ confirmed: 1, failed: [], short_pieces: shortPieces })
  }

  // ---- bulk, packed in full
  const orderIds = body.order_ids
  if (!Array.isArray(orderIds) || orderIds.length === 0) return NextResponse.json({ error: 'order_id + lines, or order_ids, is required' }, { status: 400 })
  if (orderIds.length > 500) return NextResponse.json({ error: 'Confirm at most 500 orders at a time' }, { status: 400 })

  const confirmed: string[] = []
  const failed: string[] = []
  for (const orderId of [...new Set(orderIds)]) {
    const session = await latestSession(admin, orderId)
    if (session?.result === 'completed_short') {
      const { data: o } = await admin.from('orders').select('order_no').eq('order_id', orderId).maybeSingle()
      failed.push(`${o?.order_no ?? orderId} (Short — ต้องเปิดยืนยันทีละ order)`)
      continue
    }
    const row = await flip(orderId)
    if (!row) {
      const { data: o } = await admin.from('orders').select('order_no').eq('order_id', orderId).maybeSingle()
      failed.push(o?.order_no ?? orderId)
      continue
    }
    await admin.from('pack_verifications').insert({ order_id: orderId, admin_id: caller.user_id })
    await writeStatusHistory(admin, { entityType: 'order_pack', entityId: orderId, oldStatus: 'packed', newStatus: 'confirmed', changedBy: caller.user_id })
    confirmed.push(row.order_no)
  }
  if (confirmed.length > 0) {
    await writeAudit(admin, { userId: caller.user_id, action: 'pack_verification.confirm_bulk', entityType: 'orders', entityId: null, after: { confirmed } })
  }
  return NextResponse.json({ confirmed: confirmed.length, failed })
}
