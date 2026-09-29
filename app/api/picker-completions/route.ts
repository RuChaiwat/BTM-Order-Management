import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickerActiveOrders } from '@/lib/queries/pickCompletion'
import { submitPickerCompletion } from '@/lib/pickerCompletionActions'

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
  const result_ = await submitPickerCompletion(admin, { orderId: order_id, pickerId: picker_id, result: result!, changedBy: caller.user_id })
  if (!result_.ok) return NextResponse.json({ error: result_.error }, { status: result_.httpStatus })
  return NextResponse.json({ status: result_.status }, { status: 201 })
}
