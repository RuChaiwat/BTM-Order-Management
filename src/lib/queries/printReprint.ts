import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'

export interface OpenOrderForPrint {
  orderId: string
  orderNo: string
  storeCode: string
  status: string
  pickerId: string | null
  pickerName: string | null
}

const OPEN_STATUSES = ['assigned', 'in_progress', 'correction_in_progress']

/** Print & Reprint's Pick Slip/Pick Sheet list -- only orders still open (not yet picker-
 * completed), same status set Unassign uses. An order the picker already finished drops off here
 * on its own; there's nothing left worth re-printing a pick document for. */
export async function getOpenOrdersForPrint(db: SupabaseClient, warehouseCode: string): Promise<OpenOrderForPrint[]> {
  const orders = await fetchAllRows((from, to) =>
    db.from('orders').select('order_id, order_no, store_code, status, assignment_batch_id').eq('warehouse_code', warehouseCode).in('status', OPEN_STATUSES).range(from, to),
  )

  const batchIds = [...new Set(orders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const { data: batches } = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map((batches ?? []).map((b) => [b.assignment_batch_id, b.picker_id]))

  const pickerIds = [...new Set([...pickerIdByBatch.values()].filter(Boolean))] as string[]
  const { data: pickers } = pickerIds.length ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds) : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPicker = new Map((pickers ?? []).map((p) => [p.picker_id, p.name_en]))

  return orders.map((o) => {
    const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) ?? null : null
    return {
      orderId: o.order_id,
      orderNo: o.order_no,
      storeCode: o.store_code,
      status: o.status,
      pickerId,
      pickerName: pickerId ? nameByPicker.get(pickerId) ?? pickerId : null,
    }
  })
}
