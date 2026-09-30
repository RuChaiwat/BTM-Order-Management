import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** GET ?order_no=XXX -- backs Order Pool's Cancel Order panel. Same "type/scan an Order No" scan
 * pattern already used by Work Assignment's Criteria panel, scoped to this caller's warehouse.
 * Only ever returns an order while it's still cancellable ('new' — FR-028/029, same rule
 * app/api/orders/[orderId]/cancel enforces), so the panel can't show a Cancel button for
 * something the cancel endpoint would just reject anyway. */
export async function GET(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const orderNo = searchParams.get('order_no')?.trim()
  if (!orderNo) return NextResponse.json({ error: 'order_no is required' }, { status: 400 })

  const admin = createAdminClient()
  const warehouseCode = caller.warehouse_code ?? 'DC002'
  const { data: order } = await admin
    .from('orders')
    .select('order_id, order_no, store_code, planned_pieces, status')
    .eq('warehouse_code', warehouseCode)
    .eq('order_no', orderNo)
    .maybeSingle()

  if (!order) return NextResponse.json({ error: `No order '${orderNo}' found in ${warehouseCode}` }, { status: 404 })
  if (order.status !== 'new') {
    return NextResponse.json({ error: `Order ${order.order_no} is '${order.status}' — can only cancel while New/Pending (§8)` }, { status: 409 })
  }

  return NextResponse.json({ order })
}
