import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export interface PickerActiveOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  status: string
  assigned_time: string | null
}

/** Orders currently assigned to one picker, for the office-operated Pick Completion screen.
 * Pickers never log in themselves (see migration 0015) -- an office role (System Admin/Warehouse
 * Manager/Supervisor/Zone Controller) scans or types the Picker ID here on their behalf, the same
 * way Work Assignment resolves a scanned Picker ID against the `pickers` table. Sorted oldest
 * assigned first, so the picker naturally works through their list in order. */
export async function getPickerActiveOrders(db: SupabaseClient, warehouseCode: string, pickerId: string): Promise<PickerActiveOrder[]> {
  const batchesRes = await db.from('assignment_batches').select('assignment_batch_id').eq('warehouse_code', warehouseCode).eq('picker_id', pickerId)
  const batchIds = unwrap(batchesRes).map((b) => b.assignment_batch_id)
  if (batchIds.length === 0) return []

  const ordersRes = await db
    .from('orders')
    .select('order_id, order_no, store_code, planned_pieces, status, assigned_time')
    .in('assignment_batch_id', batchIds)
    .in('status', ['assigned', 'in_progress', 'correction_in_progress'])
    .order('assigned_time')
  return unwrap(ordersRes)
}
