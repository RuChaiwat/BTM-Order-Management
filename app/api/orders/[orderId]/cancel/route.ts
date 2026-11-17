import { NextResponse } from 'next/server'
import { orderStatusTh } from '@/lib/apiError'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

/** FR-028/029, §12.1.2: Admin-initiated cancel — only while still New (§8 step 8: "at any point
 * it has not yet been Assigned"). Which post-Assigned statuses might also allow it is an open
 * item per Appendix D; this build takes the one rule the requirement states explicitly. */
export async function POST(request: Request, { params }: { params: { orderId: string } }) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { reason } = await request.json()
  if (!reason) return NextResponse.json({ error: 'กรุณาเลือกเหตุผลการยกเลิก' }, { status: 400 })

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status').eq('order_id', params.orderId).single()
  if (!order) return NextResponse.json({ error: 'ไม่พบ Order นี้' }, { status: 404 })
  if (order.status !== 'new') {
    return NextResponse.json({ error: `Order นี้อยู่ในสถานะ "${orderStatusTh(order.status)}" ยกเลิกได้เฉพาะ Order ที่ยังไม่มอบหมายงาน` }, { status: 409 })
  }

  const nowIso = new Date().toISOString()
  // Guarded on the exact status just read (compare-and-swap) -- the check above only proves the
  // order was 'new' at read time; without this, a concurrent Work Assignment / Run Matching that
  // assigns this same order between that read and this write would still let the cancel go through
  // unconditionally, stamping status='cancelled' onto an order that's now actually live picking
  // work linked to a real assignment/consolidation batch.
  const { data: updatedOrder } = await admin
    .from('orders')
    .update({ status: 'cancelled', cancelled_by: caller.user_id, cancelled_reason: reason, cancelled_at: nowIso })
    .eq('order_id', params.orderId)
    .eq('status', 'new')
    .select('order_id')
    .maybeSingle()
  if (!updatedOrder) {
    return NextResponse.json({ error: 'Order นี้เพิ่งถูกมอบหมายหรือแก้ไขจากที่อื่น กรุณารีเฟรชแล้วลองใหม่' }, { status: 409 })
  }
  await writeStatusHistory(admin, { entityType: 'orders', entityId: params.orderId, oldStatus: 'new', newStatus: 'cancelled', changedBy: caller.user_id, reason })
  await writeAudit(admin, { userId: caller.user_id, action: 'order.cancel', entityType: 'orders', entityId: params.orderId, after: { reason } })

  return NextResponse.json({ status: 'cancelled' })
}
