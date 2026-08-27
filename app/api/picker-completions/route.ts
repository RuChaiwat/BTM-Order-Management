import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

/**
 * §12.2 Picker completion. No dedicated PDA execution screen is in this build's scope (the
 * source mockups explicitly listed PDA picker screens as a "try next", not one of the 6 built
 * screens) — this endpoint is the minimum plumbing needed for orders to ever reach the Admin
 * Verification queue. "Waiting Admin Verification" (Appendix B) is treated as DERIVED — status
 * stays picker_completed_100/short, and order_alerts.is_verification_backlog is true until an
 * admin_verifications row exists — rather than a separate stored status, since Appendix B's flat
 * status list doesn't specify a single-column transition model precisely enough to do otherwise.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin', 'picker'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { order_id, actual_pieces, short_reason_code, remark } = await request.json()
  if (!order_id || actual_pieces === undefined) {
    return NextResponse.json({ error: 'order_id and actual_pieces are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status, planned_pieces').eq('order_id', order_id).single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['assigned', 'in_progress'].includes(order.status)) {
    return NextResponse.json({ error: `Order status is '${order.status}' — must be Assigned or In Progress to complete` }, { status: 409 })
  }

  const result = Number(actual_pieces) >= order.planned_pieces ? '100_percent' : 'short'
  if (result === 'short' && !short_reason_code) {
    return NextResponse.json({ error: 'short_reason_code is required for a short pick (§12.2)' }, { status: 400 })
  }

  const nowIso = new Date().toISOString()
  const { error: completionError } = await admin.from('picker_completions').insert({
    order_id,
    picker_completed_time: nowIso,
    actual_pieces,
    result,
    short_reason_code: short_reason_code ?? null,
    remark: remark ?? null,
  })
  if (completionError) return NextResponse.json({ error: completionError.message }, { status: 400 })

  const newStatus = result === '100_percent' ? 'picker_completed_100' : 'picker_completed_short'
  await admin.from('orders').update({ status: newStatus, picker_completed_time: nowIso }).eq('order_id', order_id)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: order_id, oldStatus: order.status, newStatus, changedBy: caller.user_id })
  await writeAudit(admin, { userId: caller.user_id, action: 'picker_completion.create', entityType: 'orders', entityId: order_id, after: { result, actual_pieces } })

  return NextResponse.json({ status: newStatus }, { status: 201 })
}
