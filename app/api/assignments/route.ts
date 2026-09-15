import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

/**
 * §12.1 Create an Assignment Batch — either method (list_selection / barcode_scan, FR-031) goes
 * through this same endpoint so both get identical real-time piece counting (UAT-21). FR-030's
 * single-Zone/single-Warehouse rule is enforced by the `trg_enforce_assignment_zone_warehouse`
 * DB trigger on assignment_orders (0001_init_schema.sql), which fires inside create_assignment_batch.
 *
 * The actual batch creation + order linking + status flip happens in one Postgres transaction via
 * create_assignment_batch (migration 0017) rather than as several separate round trips here. Two
 * Admins on different machines racing to assign the same order used to both pass an "is this
 * order still 'new'?" pre-check before either write landed -- that RPC row-locks every candidate
 * order first, so a losing concurrent call always sees the winner's committed result and gets a
 * clean rejection instead of a partially-double-assigned order. The pre-checks below stay only
 * for a friendlier, more specific error message on the common (non-racing) mistakes.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { warehouse_code, zone_code, picker_id, order_ids, assignment_method, linked_consolidation_batch_id } = await request.json()

  if (!warehouse_code || !zone_code || !picker_id || !Array.isArray(order_ids) || order_ids.length === 0) {
    return NextResponse.json({ error: 'warehouse_code, zone_code, picker_id and a non-empty order_ids array are required' }, { status: 400 })
  }
  if (!['list_selection', 'barcode_scan'].includes(assignment_method)) {
    return NextResponse.json({ error: "assignment_method must be 'list_selection' or 'barcode_scan'" }, { status: 400 })
  }

  const admin = createAdminClient()

  // The client now resolves picker_id by scanning a badge code rather than picking from a
  // dropdown of a trusted list -- worth validating server-side now that it's genuinely possible
  // for a stale/garbled scan to reach here. Previously this endpoint trusted picker_id outright.
  const { data: picker, error: pickerError } = await admin.from('pickers').select('picker_id, active, warehouse_code, zone_scope').eq('picker_id', picker_id).maybeSingle()
  if (pickerError) return NextResponse.json({ error: pickerError.message }, { status: 400 })
  if (!picker || !picker.active) {
    return NextResponse.json({ error: 'Picker not found or inactive — re-scan the badge' }, { status: 400 })
  }
  if (picker.warehouse_code && picker.warehouse_code !== warehouse_code) {
    return NextResponse.json({ error: 'This Picker belongs to a different warehouse' }, { status: 400 })
  }
  if (picker.zone_scope.length > 0 && !picker.zone_scope.includes(zone_code)) {
    return NextResponse.json({ error: `This Picker is not scoped to Zone ${zone_code}` }, { status: 400 })
  }

  // Friendly pre-check only -- not the actual concurrency guard, see create_assignment_batch.
  const { data: orders, error: ordersError } = await admin.from('orders').select('order_id, status').in('order_id', order_ids)
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 400 })
  if (!orders || orders.length !== order_ids.length) {
    return NextResponse.json({ error: 'One or more order_ids were not found' }, { status: 400 })
  }
  const alreadyAssigned = orders.filter((o) => o.status !== 'new')
  if (alreadyAssigned.length > 0) {
    return NextResponse.json({ error: `Order(s) not Pending: ${alreadyAssigned.map((o) => o.order_id).join(', ')} (FR-029/FR-032)` }, { status: 409 })
  }

  const { data: rpcResult, error: rpcError } = await admin.rpc('create_assignment_batch', {
    p_warehouse_code: warehouse_code,
    p_zone_code: zone_code,
    p_picker_id: picker_id,
    p_admin_id: caller.user_id,
    p_order_ids: order_ids,
    p_assignment_method: assignment_method,
    p_linked_consolidation_batch_id: linked_consolidation_batch_id ?? null,
  })
  if (rpcError) {
    if (rpcError.message.includes('ORDER_NOT_AVAILABLE')) {
      return NextResponse.json({ error: 'One or more of these orders were just assigned by someone else — refresh the pool and try again' }, { status: 409 })
    }
    return NextResponse.json({ error: rpcError.message }, { status: 400 })
  }
  const batch = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult
  if (!batch) return NextResponse.json({ error: 'Failed to create assignment batch' }, { status: 400 })

  await Promise.all(
    order_ids.map((orderId: string) =>
      writeStatusHistory(admin, { entityType: 'orders', entityId: orderId, oldStatus: 'new', newStatus: 'assigned', changedBy: caller.user_id }),
    ),
  )
  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'assignment.create',
    entityType: 'assignment_batches',
    entityId: batch.assignment_batch_id,
    after: { ...batch, order_ids },
  })

  return NextResponse.json({ assignment_batch: batch }, { status: 201 })
}
