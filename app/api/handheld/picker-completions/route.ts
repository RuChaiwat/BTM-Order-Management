import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickerActiveOrders } from '@/lib/queries/pickCompletion'
import { submitPickerCompletion } from '@/lib/pickerCompletionActions'

/**
 * Deliberately public, unauthenticated mirror of /api/picker-completions for the Picker's own
 * Handheld device -- Pickers have no login of their own (migration 0015: pickers and system Users
 * are entirely separate tables), so this is the one place in the app that intentionally has no
 * requireRole() gate at all. The Handheld's own trust boundary is physical: possession of the
 * device on the warehouse floor (or its network), not an app-level login -- the same boundary the
 * original "Pickers never log in" design already assumed, just now actually reachable without an
 * office role in the loop.
 *
 * Kept as its OWN route (not a flag on the authenticated one) so this narrower, public surface
 * can't widen what the authenticated office route allows: only picker lookup and completion
 * submission are exposed here, nothing else this app does. Warehouse scope comes from the
 * picker's own row (there is no caller.warehouse_code to fall back to), and every write is
 * credited to no one (`changedBy: null`) rather than a fabricated identity -- see
 * submitPickerCompletion, shared with the authenticated route so the business rules can't drift
 * between the two.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const pickerId = searchParams.get('picker_id')?.trim().toUpperCase()
  if (!pickerId) return NextResponse.json({ error: 'picker_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: picker } = await admin.from('pickers').select('picker_id, name_en, name_th, active, warehouse_code').eq('picker_id', pickerId).maybeSingle()
  if (!picker) return NextResponse.json({ error: `No picker with ID '${pickerId}'` }, { status: 404 })
  if (!picker.active) return NextResponse.json({ error: `${picker.name_en} (${picker.picker_id}) is inactive` }, { status: 409 })

  const orders = await getPickerActiveOrders(admin, picker.warehouse_code, pickerId)
  return NextResponse.json({ picker, orders })
}

export async function POST(request: Request) {
  const { order_id, picker_id, result } = (await request.json()) as { order_id?: string; picker_id?: string; result?: '100_percent' | 'short' }
  if (!order_id || !picker_id || !['100_percent', 'short'].includes(result ?? '')) {
    return NextResponse.json({ error: "order_id, picker_id, and result ('100_percent' | 'short') are required" }, { status: 400 })
  }

  const admin = createAdminClient()
  const result_ = await submitPickerCompletion(admin, { orderId: order_id, pickerId: picker_id, result: result!, changedBy: null })
  if (!result_.ok) return NextResponse.json({ error: result_.error }, { status: result_.httpStatus })
  return NextResponse.json({ status: result_.status }, { status: 201 })
}
