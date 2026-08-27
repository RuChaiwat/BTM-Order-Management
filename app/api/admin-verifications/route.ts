import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

/** §12 admin verification: Final Close or Reject-for-correction. Waiting time here is excluded
 * from picker productivity (§12.2) — cycle time is already fixed at picker_completed_time. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { order_id, decision, reject_reason } = await request.json()
  if (!order_id || !['final_close', 'reject'].includes(decision)) {
    return NextResponse.json({ error: "order_id and decision ('final_close' | 'reject') are required" }, { status: 400 })
  }
  if (decision === 'reject' && !reject_reason) {
    return NextResponse.json({ error: 'reject_reason is required to reject (§12.1, audit trail)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status').eq('order_id', order_id).single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['picker_completed_100', 'picker_completed_short'].includes(order.status)) {
    return NextResponse.json({ error: `Order status is '${order.status}' — must be Picker Completed to verify` }, { status: 409 })
  }

  const { error: verificationError } = await admin.from('admin_verifications').insert({
    order_id,
    admin_id: caller.user_id,
    decision,
    reject_reason: decision === 'reject' ? reject_reason : null,
  })
  if (verificationError) return NextResponse.json({ error: verificationError.message }, { status: 400 })

  const newStatus = decision === 'final_close' ? (order.status === 'picker_completed_100' ? 'final_closed_100' : 'final_closed_short') : 'correction_in_progress'

  await admin.from('orders').update({ status: newStatus }).eq('order_id', order_id)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: order_id, oldStatus: order.status, newStatus, changedBy: caller.user_id, reason: reject_reason })
  await writeAudit(admin, { userId: caller.user_id, action: `admin_verification.${decision}`, entityType: 'orders', entityId: order_id, after: { newStatus, reject_reason } })

  return NextResponse.json({ status: newStatus })
}
