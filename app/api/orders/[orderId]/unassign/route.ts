import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

/**
 * Admin-initiated recall from Pick Completion (office-only, never Handheld -- a Picker can't
 * choose this for themselves): a picker who can't finish an order by end of shift gets it pulled
 * back to the pool for someone else, instead of it sitting on their list forever. Stops the
 * order's clock (assignment_batch_id/assigned_time cleared) and reverts it to 'new' so Work
 * Assignment's pool picks it straight back up. Same role set as Confirm Assignment, since this is
 * that action's inverse.
 *
 * Blocked for an order still linked to a Consolidation Batch: pickerCompletionActions.ts's
 * auto-complete cascade counts an order out of `assigned/in_progress/correction_in_progress` as
 * "done" for that batch -- reverting to 'new' here would look the same to that cascade as an
 * actual completion and could wrongly auto-close the batch. Recalling a consolidated order needs
 * to go through Consolidation Pick Report instead, which already has its own batch-aware flow.
 */
export async function POST(request: Request, { params }: { params: { orderId: string } }) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status, assignment_batch_id, consolidation_batch_id').eq('order_id', params.orderId).single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['assigned', 'in_progress', 'correction_in_progress'].includes(order.status)) {
    return NextResponse.json({ error: `Order status is '${order.status}' — can only unassign while Assigned, In Progress, or Returned for correction` }, { status: 409 })
  }
  if (order.consolidation_batch_id) {
    return NextResponse.json({ error: 'This order is part of a Consolidation Batch — unassign it from Consolidation Pick Report instead' }, { status: 409 })
  }

  if (order.assignment_batch_id) {
    await admin.from('assignment_orders').delete().eq('assignment_batch_id', order.assignment_batch_id).eq('order_id', params.orderId)
  }
  await admin.from('orders').update({ status: 'new', assignment_batch_id: null, assigned_time: null }).eq('order_id', params.orderId)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: params.orderId, oldStatus: order.status, newStatus: 'new', changedBy: caller.user_id, reason: 'Unassigned by admin from Pick Completion' })
  await writeAudit(admin, { userId: caller.user_id, action: 'order.unassign', entityType: 'orders', entityId: params.orderId, before: { status: order.status, assignment_batch_id: order.assignment_batch_id } })

  return NextResponse.json({ status: 'new' })
}
