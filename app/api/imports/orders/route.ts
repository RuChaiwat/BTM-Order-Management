import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { parseSpreadsheet, col } from '@/lib/importers/parseSpreadsheet'

/**
 * §5 WMS order import (Transfer Order export). Confirmed field mapping (§5, Appendix A):
 *   Transfer -> Order No, Warehouse Code -> Warehouse Code, Shipment Date -> Original Order Date,
 *   Item No. -> SKU, Bin Code -> Bin Code, Quantity -> QTY, Description -> Item Description,
 *   SKU Barcode -> Supplier Barcode.
 *
 * SKU Barcode is the barcode physically printed on the item by the supplier — distinct from Item
 * No., which is Beautrium's internal code and is never printed on the item itself. The
 * Consolidation Pick Report must scan against what's actually on the item, so this is required,
 * not optional, the same as Bin Code.
 *
 * Known limitation: this runs as a sequence of PostgREST calls, not a single DB transaction — a
 * mid-import crash can leave a partially-imported batch. import_batches.status lets you see that
 * happened; a Postgres RPC function would make this atomic and is a reasonable follow-up once
 * import volume/reliability requirements are confirmed with Business.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'planner_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 })
  }

  const rows = await parseSpreadsheet(file)
  const admin = createAdminClient()

  const { data: importBatch, error: importBatchError } = await admin
    .from('import_batches')
    .insert({ file_name: file.name, uploaded_by: caller.user_id, status: 'validating', total_rows: rows.length })
    .select()
    .single()
  if (importBatchError || !importBatch) {
    return NextResponse.json({ error: importBatchError?.message ?? 'Failed to create import batch' }, { status: 500 })
  }

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
  const preValidationErrors: { rowNumber: number; raw: Record<string, string>; reason: string }[] = []

  rows.forEach((row, i) => {
    const rowNumber = i + 2 // header is row 1
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
      preValidationErrors.push({ rowNumber, raw: row, reason: `Missing/invalid required field(s): ${missing.join(', ')}` })
      return
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
  })

  const warehouseCodes = [...new Set(parsed.map((p) => p.warehouseCode))]
  const { data: locations } = await admin
    .from('locations')
    .select('warehouse_code, bin_code, zone_code, pick_sequence, active')
    .in('warehouse_code', warehouseCodes)
  const locationMap = new Map((locations ?? []).map((l) => [`${l.warehouse_code}|${l.bin_code}`, l]))

  const binErrors: { rowNumber: number; raw: Record<string, string>; reason: string }[] = []

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
          import_id: importBatch.import_id,
        })
        .select('order_id')
        .single()
      if (newOrderError || !newOrder) {
        group.lines.forEach((l) => binErrors.push({ rowNumber: l.rowNumber, raw: l.raw, reason: `Failed to create order: ${newOrderError?.message}` }))
        continue
      }
      orderId = newOrder.order_id
      ordersCreated++
    }

    for (const line of group.lines) {
      const location = locationMap.get(`${line.warehouseCode}|${line.binCode}`)
      if (!location || !location.active) {
        binErrors.push({ rowNumber: line.rowNumber, raw: line.raw, reason: `Invalid Bin Code '${line.binCode}': not found in Location Master or inactive (§5.2, UAT-03)` })
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
      else binErrors.push({ rowNumber: line.rowNumber, raw: line.raw, reason: lineError.message })
    }

    const { data: lineAgg } = await admin.from('order_lines').select('sku, qty').eq('order_id', orderId)
    const plannedPieces = (lineAgg ?? []).reduce((sum, l) => sum + Number(l.qty), 0)
    const uniqueSkuCount = new Set((lineAgg ?? []).map((l) => l.sku)).size
    await admin.from('orders').update({ planned_pieces: plannedPieces, unique_sku_count: uniqueSkuCount }).eq('order_id', orderId)
  }

  const allErrors = [...preValidationErrors, ...binErrors]
  if (allErrors.length > 0) {
    await admin.from('import_errors').insert(
      allErrors.map((e) => ({ import_id: importBatch.import_id, row_number: e.rowNumber, raw_data: e.raw, error_reason: e.reason })),
    )
  }

  const finalStatus = allErrors.length === 0 ? 'completed' : parsed.length === 0 ? 'failed' : 'completed_with_errors'
  await admin
    .from('import_batches')
    .update({
      status: finalStatus,
      success_rows: parsed.length - binErrors.length,
      error_rows: allErrors.length,
      finished_at: new Date().toISOString(),
    })
    .eq('import_id', importBatch.import_id)

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'orders.import',
    entityType: 'import_batches',
    entityId: importBatch.import_id,
    after: { orders_created: ordersCreated, orders_updated: ordersUpdated, lines_upserted: linesUpserted, errors: allErrors.length },
  })

  return NextResponse.json({
    import_id: importBatch.import_id,
    status: finalStatus,
    orders_created: ordersCreated,
    orders_updated: ordersUpdated,
    lines_upserted: linesUpserted,
    error_count: allErrors.length,
  })
}

/** WMS dates observed as-is in sample exports; accepts YYYY-MM-DD or DD/MM/YYYY and normalizes to ISO. */
function normalizeDate(value: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  const m = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return value
}
