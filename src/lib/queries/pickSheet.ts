import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export interface PickSheetLine {
  lineId: string
  zoneCode: string
  binCode: string
  sku: string
  itemDescription: string | null
  qty: number
  uomCode: string
}

export interface PickSheetRow {
  orderId: string
  orderNo: string
  storeCode: string
  orderDate: string
  warehouseCode: string
  pickerName: string
  lines: PickSheetLine[]
}

/** §Print & Reprint follow-up: the item-level companion to Pick Slip -- same header fields
 * (Transfer From/To Store/Order Date/Picker), but a full line list instead of just a barcode
 * docket, for the picker to physically walk the warehouse with. Sorted by `pick_sequence` --
 * Location Master's own composite walking-order key (migration 0011), denormalized onto each
 * order_line at import time -- not by zone_code: this key already encodes the zone a line sits in
 * as part of its own ordering, so a plain ascending sort naturally groups same-zone lines together
 * AND orders the zones themselves in walking sequence; the document groups by zone purely for
 * display (a heading band between runs), not as a second sort key. */
export async function getPickSheetData(db: SupabaseClient, orderIds: string[]): Promise<PickSheetRow[]> {
  if (orderIds.length === 0) return []

  const [ordersRes, linesRes] = await Promise.all([
    db.from('orders').select('order_id, order_no, store_code, original_order_date, warehouse_code, assignment_batch_id').in('order_id', orderIds),
    db.from('order_lines').select('line_id, order_id, zone_code, bin_code, sku, item_description, qty, uom_code, pick_sequence').in('order_id', orderIds),
  ])
  const orders = unwrap(ordersRes)
  const allLines = unwrap(linesRes)

  const batchIds = [...new Set(orders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))

  const pickerIds = [...new Set([...pickerIdByBatch.values()].filter(Boolean))] as string[]
  const pickersRes = pickerIds.length ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds) : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))

  const linesByOrder = new Map<string, typeof allLines>()
  for (const l of allLines) {
    if (!linesByOrder.has(l.order_id)) linesByOrder.set(l.order_id, [])
    linesByOrder.get(l.order_id)!.push(l)
  }

  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  return orderIds
    .map((orderId): PickSheetRow | null => {
      const o = orderById.get(orderId)
      if (!o) return null
      const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
      const sortedLines = (linesByOrder.get(orderId) ?? [])
        .slice()
        .sort((a, b) => (a.pick_sequence ?? '').localeCompare(b.pick_sequence ?? '') || a.bin_code.localeCompare(b.bin_code))
      return {
        orderId,
        orderNo: o.order_no,
        storeCode: o.store_code,
        orderDate: o.original_order_date,
        warehouseCode: o.warehouse_code,
        pickerName: (pickerId && nameByPicker.get(pickerId)) ?? pickerId ?? '—',
        lines: sortedLines.map((l) => ({
          lineId: l.line_id,
          zoneCode: l.zone_code ?? '—',
          binCode: l.bin_code,
          sku: l.sku,
          itemDescription: l.item_description,
          qty: Number(l.qty),
          uomCode: l.uom_code ?? 'PCS',
        })),
      }
    })
    .filter((s): s is PickSheetRow => s !== null)
}
