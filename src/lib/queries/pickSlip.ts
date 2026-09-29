import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export interface PickSlipRow {
  orderId: string
  orderNo: string
  storeCode: string
  orderDate: string
  zones: string[]
  warehouseCode: string
  pickerName: string
}

/** Work Assignment's own Pick Slip -- one 80mm slip per requested order, printed automatically
 * right after Confirm Assignment, and re-printable any time afterward from Pick Completion (paper
 * jam, printer out of paper, picker lost the slip) -- see PickCompletionBoard's "Reprint Slip" /
 * "Reprint All" buttons. Keyed by order_id rather than assignment_batch_id so both call sites work
 * the same way: printing right after creating a batch and reprinting a single order later are the
 * same operation, just with a different list of order_ids.
 *
 * Zone here is deliberately the order's OWN touched zone(s) (order_lines.zone_code), not the
 * assignment batch's single zone_code -- a consolidation-linked batch can span multiple zones
 * (zone_code = 'MULTI'), and even an ordinary batch's zone_code only says which zone the batch was
 * CREATED under, not every zone a given order's lines actually sit in. Picker/warehouse are
 * resolved per order via its own assignment_batch_id (not assumed to be the same across every
 * requested order_id), so a reprint still works correctly even if the given orders happen to span
 * more than one batch or picker. */
export async function getPickSlipData(db: SupabaseClient, orderIds: string[]): Promise<PickSlipRow[]> {
  if (orderIds.length === 0) return []

  const [ordersRes, linesRes] = await Promise.all([
    db.from('orders').select('order_id, order_no, store_code, original_order_date, warehouse_code, assignment_batch_id').in('order_id', orderIds),
    db.from('order_lines').select('order_id, zone_code').in('order_id', orderIds),
  ])
  const orders = unwrap(ordersRes)

  const zonesByOrder = new Map<string, Set<string>>()
  for (const l of unwrap(linesRes)) {
    if (!l.zone_code) continue
    if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
    zonesByOrder.get(l.order_id)!.add(l.zone_code)
  }

  const batchIds = [...new Set(orders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))

  const pickerIds = [...new Set([...pickerIdByBatch.values()].filter(Boolean))] as string[]
  const pickersRes = pickerIds.length ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds) : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))

  // Preserve the caller's own order_ids ordering (e.g. Work Assignment's selection order) rather
  // than whatever order the orders table happened to return.
  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  return orderIds
    .map((orderId): PickSlipRow | null => {
      const o = orderById.get(orderId)
      if (!o) return null
      const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
      return {
        orderId,
        orderNo: o.order_no,
        storeCode: o.store_code,
        orderDate: o.original_order_date,
        zones: [...(zonesByOrder.get(orderId) ?? new Set())].sort(),
        warehouseCode: o.warehouse_code,
        pickerName: (pickerId && nameByPicker.get(pickerId)) ?? pickerId ?? '—',
      }
    })
    .filter((s): s is PickSlipRow => s !== null)
}
