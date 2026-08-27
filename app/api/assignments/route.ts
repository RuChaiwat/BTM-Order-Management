import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

const TARGET = 300
const LOW_MAX = 270
const ACCEPTABLE_MAX = 330

function workloadStatus(pieces: number) {
  if (pieces < LOW_MAX) return 'low'
  if (pieces <= TARGET) return 'target'
  if (pieces <= ACCEPTABLE_MAX) return 'acceptable_over'
  return 'over'
}

/**
 * §12.1 Create an Assignment Batch — either method (list_selection / barcode_scan, FR-031) goes
 * through this same endpoint so both get identical real-time piece counting (UAT-21). FR-030's
 * single-Zone/single-Warehouse rule is enforced by the `trg_enforce_assignment_zone_warehouse`
 * DB trigger on assignment_orders (0001_init_schema.sql) — this insert is the layer that trips it.
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

  const { data: orders, error: ordersError } = await admin.from('orders').select('order_id, planned_pieces, status').in('order_id', order_ids)
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 400 })
  if (!orders || orders.length !== order_ids.length) {
    return NextResponse.json({ error: 'One or more order_ids were not found' }, { status: 400 })
  }
  const alreadyAssigned = orders.filter((o) => o.status !== 'new')
  if (alreadyAssigned.length > 0) {
    return NextResponse.json({ error: `Order(s) not Pending: ${alreadyAssigned.map((o) => o.order_id).join(', ')} (FR-029/FR-032)` }, { status: 409 })
  }

  const plannedPieces = orders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
  const nowIso = new Date().toISOString()

  const { data: batch, error: batchError } = await admin
    .from('assignment_batches')
    .insert({
      warehouse_code,
      zone_code,
      picker_id,
      admin_id: caller.user_id,
      assigned_time: nowIso,
      planned_pieces: plannedPieces,
      workload_status: workloadStatus(plannedPieces),
      assignment_method,
      status: 'assigned',
      linked_consolidation_batch_id: linked_consolidation_batch_id ?? null,
    })
    .select()
    .single()
  if (batchError || !batch) return NextResponse.json({ error: batchError?.message ?? 'Failed to create assignment batch' }, { status: 400 })

  // Single bulk INSERT — statement-level atomicity means if the FR-030 trigger rejects any one
  // row (wrong zone/warehouse, or a Cancelled order slipping through), the whole insert rolls
  // back and no assignment_orders rows are left half-committed.
  const { error: linkError } = await admin.from('assignment_orders').insert(
    order_ids.map((orderId: string, i: number) => ({
      assignment_batch_id: batch.assignment_batch_id,
      order_id: orderId,
      sequence: i + 1,
      source_type: linked_consolidation_batch_id ? 'consolidation' : 'single',
      source_id: linked_consolidation_batch_id ?? null,
    })),
  )
  if (linkError) {
    await admin.from('assignment_batches').delete().eq('assignment_batch_id', batch.assignment_batch_id)
    return NextResponse.json({ error: linkError.message }, { status: 409 })
  }

  await admin
    .from('orders')
    .update({ status: 'assigned', assigned_time: nowIso, assignment_batch_id: batch.assignment_batch_id })
    .in('order_id', order_ids)

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
