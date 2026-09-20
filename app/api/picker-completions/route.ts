import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'
import { getPickerActiveOrders } from '@/lib/queries/pickCompletion'

/** GET ?picker_id=XXX -- the office-operated Pick Completion screen scans/types a Picker ID and
 * pulls up that picker's own active order list (pickers never log in themselves, see migration
 * 0015). */
export async function GET(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'warehouse_manager', 'supervisor', 'zone_controller'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const pickerId = searchParams.get('picker_id')?.trim().toUpperCase()
  if (!pickerId) return NextResponse.json({ error: 'picker_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const warehouseCode = caller.warehouse_code ?? 'DC002'
  const { data: picker } = await admin.from('pickers').select('picker_id, name_en, name_th, active').eq('picker_id', pickerId).eq('warehouse_code', warehouseCode).maybeSingle()
  if (!picker) return NextResponse.json({ error: `No picker with ID '${pickerId}' in ${warehouseCode}` }, { status: 404 })
  if (!picker.active) return NextResponse.json({ error: `${picker.name_en} (${picker.picker_id}) is inactive` }, { status: 409 })

  const orders = await getPickerActiveOrders(admin, warehouseCode, pickerId)
  return NextResponse.json({ picker, orders })
}

/**
 * Pick Completion redesign: the picker only reports a coarse result -- Completed (100%) or
 * Completed with Short -- no per-line quantity or reason. Admin Verification is where the real
 * short quantity/reason gets entered, against the actual WMS confirmation. Confirming here stops
 * the order's clock (picker_completed_time) and moves it into the Admin Verification queue.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'warehouse_manager', 'supervisor', 'zone_controller'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { order_id, picker_id, result } = (await request.json()) as { order_id?: string; picker_id?: string; result?: '100_percent' | 'short' }
  if (!order_id || !picker_id || !['100_percent', 'short'].includes(result ?? '')) {
    return NextResponse.json({ error: "order_id, picker_id, and result ('100_percent' | 'short') are required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status, planned_pieces, assignment_batch_id').eq('order_id', order_id).single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['assigned', 'in_progress', 'correction_in_progress'].includes(order.status)) {
    return NextResponse.json({ error: `Order status is '${order.status}' — must be Assigned, In Progress, or returned for correction to complete` }, { status: 409 })
  }

  const { data: batch } = await admin.from('assignment_batches').select('picker_id').eq('assignment_batch_id', order.assignment_batch_id ?? '').maybeSingle()
  if (!batch || batch.picker_id !== picker_id) {
    return NextResponse.json({ error: 'This order is not assigned to that picker' }, { status: 409 })
  }

  // actual_pieces is only really known for a full pick -- for a short completion, the real count
  // isn't known until Admin checks the WMS and enters it during verification (nullable since
  // migration 0021).
  const actualPieces = result === '100_percent' ? order.planned_pieces : null
  const nowIso = new Date().toISOString()
  const { error: completionError } = await admin
    .from('picker_completions')
    .upsert({ order_id, picker_completed_time: nowIso, actual_pieces: actualPieces, result }, { onConflict: 'order_id' })
  if (completionError) return NextResponse.json({ error: completionError.message }, { status: 400 })

  const newStatus = result === '100_percent' ? 'picker_completed_100' : 'picker_completed_short'
  await admin.from('orders').update({ status: newStatus, picker_completed_time: nowIso }).eq('order_id', order_id)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: order_id, oldStatus: order.status, newStatus, changedBy: caller.user_id })
  await writeAudit(admin, { userId: caller.user_id, action: 'picker_completion.create', entityType: 'orders', entityId: order_id, after: { result, picker_id } })

  return NextResponse.json({ status: newStatus }, { status: 201 })
}
