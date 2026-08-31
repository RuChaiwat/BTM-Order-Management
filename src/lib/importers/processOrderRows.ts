import type { SupabaseClient } from '@supabase/supabase-js'
import { col, normalizeDate } from './parseSpreadsheet'

export interface RawImportRow {
  rowNumber: number
  data: Record<string, string>
}

export interface ImportErrorRow {
  rowNumber: number
  raw: Record<string, string>
  reason: string
  severity: 'blocking' | 'warning'
}

export interface BatchResult {
  ordersCreated: number
  ordersUpdated: number
  linesUpserted: number
  errors: ImportErrorRow[]
}

/**
 * §5 WMS order import (Transfer Order export), processing one batch of already-parsed rows
 * against an existing import_batches row. Extracted so both the (now removed) one-shot endpoint
 * and the start/batch/finish chunked flow (used for real per-batch progress, see OrderImportForm)
 * share one implementation. Confirmed field mapping (§5, Appendix A):
 *   Transfer -> Order No, Warehouse Code -> Warehouse Code, Shipment Date -> Original Order Date,
 *   Item No. -> SKU, SKU Barcode -> Supplier Barcode, Bin Code -> Bin Code, Quantity -> QTY,
 *   Description -> Item Description.
 *
 * SKU Barcode is the barcode physically printed on the item by the supplier — distinct from Item
 * No., which is Beautrium's internal code and is never printed on the item itself. Required, same
 * strictness as Bin Code.
 *
 * Known limitation: this runs as a sequence of PostgREST calls per order, not a single DB
 * transaction — a mid-batch crash can leave that batch partially written. A Postgres RPC function
 * would make each batch atomic and is a reasonable follow-up once import volume/reliability
 * requirements are confirmed with Business.
 */
export async function processOrderRowsBatch(admin: SupabaseClient, importId: string, rawRows: RawImportRow[]): Promise<BatchResult> {
  type ParsedLine = {
    rowNumber: number
    orderNo: string
    warehouseCode: string
    originalOrderDate: string
    storeCode: string
    sku: string
    skuBarcode: string
    binCode: string
    qty: number
    uomCode: string
    itemDescription: string
    raw: Record<string, string>
  }

  const parsed: ParsedLine[] = []
  const errors: ImportErrorRow[] = []

  for (const { rowNumber, data: row } of rawRows) {
    const orderNo = col(row, 'Transfer', 'Order No')
    const warehouseCode = col(row, 'Warehouse Code')
    const originalOrderDate = col(row, 'Shipment Date', 'Original Order Date')
    const storeCode = col(row, 'Store Code')
    const sku = col(row, 'Item No.', 'Item No', 'SKU')
    const skuBarcode = col(row, 'SKU Barcode', 'Supplier Barcode', 'Barcode')
    const binCode = col(row, 'Bin Code')
    const qtyRaw = col(row, 'Quantity', 'QTY')
    const qty = Number(qtyRaw)

    const missing = [
      !orderNo && 'Order No',
      !warehouseCode && 'Warehouse Code',
      !originalOrderDate && 'Shipment Date',
      !storeCode && 'Store Code',
      !sku && 'Item No.',
      !skuBarcode && 'SKU Barcode',
      !binCode && 'Bin Code',
      (!qtyRaw || Number.isNaN(qty) || qty <= 0) && 'Quantity',
    ].filter(Boolean)

    if (missing.length > 0) {
      errors.push({ rowNumber, raw: row, reason: `Missing/invalid required field(s): ${missing.join(', ')} — this row was NOT imported, fix and re-upload it`, severity: 'blocking' })
      continue
    }

    parsed.push({
      rowNumber,
      orderNo,
      warehouseCode,
      originalOrderDate: normalizeDate(originalOrderDate),
      storeCode,
      sku,
      skuBarcode,
      binCode,
      qty,
      uomCode: col(row, 'Unit of Measure Code', 'UOM') || 'PCS',
      itemDescription: col(row, 'Description', 'Item Description'),
      raw: row,
    })
  }

  // Filtered by the actual Bin Codes this batch needs, not the whole warehouse — Location Master
  // can be tens of thousands of rows, and an unfiltered select silently truncates at Supabase's
  // default row cap (1000), which made most Bin Code lookups fail even for real, active bins
  // once Location Master grew past that.
  const warehouseCodes = [...new Set(parsed.map((p) => p.warehouseCode))]
  const binCodes = [...new Set(parsed.map((p) => p.binCode))]
  const { data: locations } = warehouseCodes.length && binCodes.length
    ? await admin.from('locations').select('warehouse_code, bin_code, zone_code, pick_sequence, active').in('warehouse_code', warehouseCodes).in('bin_code', binCodes)
    : { data: [] as { warehouse_code: string; bin_code: string; zone_code: string | null; pick_sequence: string | null; active: boolean }[] }
  const locationMap = new Map((locations ?? []).map((l) => [`${l.warehouse_code}|${l.bin_code}`, l]))

  type OrderGroup = { key: string; warehouseCode: string; orderNo: string; originalOrderDate: string; storeCode: string; lines: ParsedLine[] }
  const groups = new Map<string, OrderGroup>()
  for (const line of parsed) {
    const key = `${line.warehouseCode}|${line.orderNo}|${line.originalOrderDate}`
    if (!groups.has(key)) {
      groups.set(key, { key, warehouseCode: line.warehouseCode, orderNo: line.orderNo, originalOrderDate: line.originalOrderDate, storeCode: line.storeCode, lines: [] })
    }
    groups.get(key)!.lines.push(line)
  }

  let ordersCreated = 0
  let ordersUpdated = 0
  let linesUpserted = 0

  for (const group of groups.values()) {
    const { data: existingOrder } = await admin
      .from('orders')
      .select('order_id, status')
      .eq('warehouse_code', group.warehouseCode)
      .eq('order_no', group.orderNo)
      .eq('original_order_date', group.originalOrderDate)
      .maybeSingle()

    let orderId: string
    if (existingOrder) {
      orderId = existingOrder.order_id
      ordersUpdated++
    } else {
      const { data: newOrder, error: newOrderError } = await admin
        .from('orders')
        .insert({
          order_no: group.orderNo,
          warehouse_code: group.warehouseCode,
          original_order_date: group.originalOrderDate,
          store_code: group.storeCode,
          status: 'new',
          import_id: importId,
        })
        .select('order_id')
        .single()
      if (newOrderError || !newOrder) {
        group.lines.forEach((l) => errors.push({ rowNumber: l.rowNumber, raw: l.raw, reason: `Failed to create order: ${newOrderError?.message} — this row was NOT imported, fix and re-upload it`, severity: 'blocking' }))
        continue
      }
      orderId = newOrder.order_id
      ordersCreated++
    }

    for (const line of group.lines) {
      const location = locationMap.get(`${line.warehouseCode}|${line.binCode}`)
      if (!location || !location.active) {
        errors.push({
          rowNumber: line.rowNumber,
          raw: line.raw,
          reason: `Invalid Bin Code '${line.binCode}': not found in Location Master or inactive (§5.2, UAT-03) — the order line was still imported, but has no Zone/Pick Sequence. Safe to leave, or fix the Bin Code and re-upload to backfill it.`,
          severity: 'warning',
        })
      }

      const { error: lineError } = await admin.from('order_lines').upsert(
        {
          order_id: orderId,
          sku: line.sku,
          sku_barcode: line.skuBarcode,
          bin_code: line.binCode,
          warehouse_code: line.warehouseCode,
          qty: line.qty,
          uom_code: line.uomCode,
          item_description: line.itemDescription || null,
          source_line_id: '',
          zone_code: location?.active ? location.zone_code : null,
          pick_sequence: location?.active ? location.pick_sequence : null,
        },
        { onConflict: 'order_id,sku,bin_code,source_line_id' },
      )
      if (!lineError) linesUpserted++
      else errors.push({ rowNumber: line.rowNumber, raw: line.raw, reason: `${lineError.message} — this row was NOT imported, fix and re-upload it`, severity: 'blocking' })
    }

    const { data: lineAgg } = await admin.from('order_lines').select('sku, qty').eq('order_id', orderId)
    const plannedPieces = (lineAgg ?? []).reduce((sum, l) => sum + Number(l.qty), 0)
    const uniqueSkuCount = new Set((lineAgg ?? []).map((l) => l.sku)).size
    await admin.from('orders').update({ planned_pieces: plannedPieces, unique_sku_count: uniqueSkuCount }).eq('order_id', orderId)
  }

  if (errors.length > 0) {
    await admin.from('import_errors').insert(errors.map((e) => ({ import_id: importId, row_number: e.rowNumber, raw_data: e.raw, error_reason: e.reason, severity: e.severity })))
  }

  return { ordersCreated, ordersUpdated, linesUpserted, errors }
}
