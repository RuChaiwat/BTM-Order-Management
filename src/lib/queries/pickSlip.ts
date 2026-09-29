import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export interface PickSlipRow {
  orderId: string
  orderNo: string
  storeCode: string
  orderDate: string
  zones: string[]
}

export interface PickSlipData {
  warehouseCode: string
  pickerName: string
  slips: PickSlipRow[]
}

/** Work Assignment's own Pick Slip -- one 80mm slip per order in the just-confirmed batch, printed
 * immediately so the picker physically holds a count of how many orders they were handed (§ Work
 * Assignment confirm step, design approved separately). Zone here is deliberately the order's OWN
 * touched zone(s) (order_lines.zone_code), not the batch's single zone_code -- a consolidation-
 * linked batch can span multiple zones (zone_code = 'MULTI'), and even an ordinary batch's zone_code
 * only says which zone the batch was CREATED under, not every zone a given order's lines actually
 * sit in. */
export async function getPickSlipData(db: SupabaseClient, assignmentBatchId: string): Promise<PickSlipData | null> {
  const { data: batch } = await db.from('assignment_batches').select('assignment_batch_id, warehouse_code, picker_id').eq('assignment_batch_id', assignmentBatchId).maybeSingle()
  if (!batch) return null

  const [orderIdsRes, pickerRes] = await Promise.all([
    db.from('assignment_orders').select('order_id, sequence').eq('assignment_batch_id', assignmentBatchId).order('sequence', { ascending: true }),
    batch.picker_id ? db.from('pickers').select('name_en').eq('picker_id', batch.picker_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const orderIds = unwrap(orderIdsRes).map((r) => r.order_id)
  if (orderIds.length === 0) return { warehouseCode: batch.warehouse_code, pickerName: pickerRes.data?.name_en ?? batch.picker_id ?? '—', slips: [] }

  const [ordersRes, linesRes] = await Promise.all([
    db.from('orders').select('order_id, order_no, store_code, original_order_date').in('order_id', orderIds),
    db.from('order_lines').select('order_id, zone_code').in('order_id', orderIds),
  ])
  const orders = unwrap(ordersRes)
  const orderById = new Map(orders.map((o) => [o.order_id, o]))

  const zonesByOrder = new Map<string, Set<string>>()
  for (const l of unwrap(linesRes)) {
    if (!l.zone_code) continue
    if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
    zonesByOrder.get(l.order_id)!.add(l.zone_code)
  }

  const slips = orderIds
    .map((orderId): PickSlipRow | null => {
      const o = orderById.get(orderId)
      if (!o) return null
      return {
        orderId,
        orderNo: o.order_no,
        storeCode: o.store_code,
        orderDate: o.original_order_date,
        zones: [...(zonesByOrder.get(orderId) ?? new Set())].sort(),
      }
    })
    .filter((s): s is PickSlipRow => s !== null)

  return { warehouseCode: batch.warehouse_code, pickerName: pickerRes.data?.name_en ?? batch.picker_id ?? '—', slips }
}
