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
 * Performance: every DB round trip here is batched across the WHOLE call (one order lookup, one
 * order insert, one order_lines upsert, one order_lines re-aggregation, one orders upsert for the
 * computed totals) instead of once per order-group or once per line. The original per-order/
 * per-line version made one network round trip per line, which at ~15-20k lines/day (WMS Transfer
 * Order export scale) meant tens of thousands of sequential awaited round trips per import --
 * confirmed as the actual bottleneck (not the parse, not the upload transfer). This version does a
 * small constant number of round trips regardless of how many orders/lines are in the call, so
 * OrderImportForm's ORDERS_PER_BATCH can be turned up (fewer, larger HTTP calls) without turning
 * any per-order work back into a per-order round trip.
 *
 * Known limitation: still not one DB transaction (a mid-batch crash can leave a batch partially
 * written) -- a Postgres RPC function would make each batch atomic and is a reasonable follow-up
 * once import volume/reliability requirements are confirmed with Business. A batch insert failure
 * also fails closed for every new order in that HTTP call at once (rather than isolating just the
 * conflicting one) -- rare in practice (it only bites two concurrent imports racing to create the
 * exact same order), and simply re-uploading the same file resolves it, since the retry's lookup
 * step now finds those orders already created.
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
    ? await admin.from('locations').select('warehouse_code, bin_code, zone_code, pick_sequence, active').in('warehouse_code', warehouseCodes).in('bin_code', binCodes).limit(50000)
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
  const groupList = [...groups.values()]

  // Step 1: one bulk lookup for every order-group this batch might already have, instead of one
  // .maybeSingle() per group. The three .in() filters are a superset (matching each column
  // independently, not the exact triple) -- re-keyed by the same composite string below, so an
  // over-fetched non-match is simply ignored, never misapplied.
  const orderNos = [...new Set(groupList.map((g) => g.orderNo))]
  const orderDates = [...new Set(groupList.map((g) => g.originalOrderDate))]
  const { data: existingOrdersRaw, error: existingOrdersError } =
    warehouseCodes.length && orderNos.length && orderDates.length
      ? await admin
          .from('orders')
          .select('order_id, order_no, warehouse_code, original_order_date, status')
          .in('warehouse_code', warehouseCodes)
          .in('order_no', orderNos)
          .in('original_order_date', orderDates)
          .limit(50000)
      : { data: [] as { order_id: string; order_no: string; warehouse_code: string; original_order_date: string; status: string }[], error: null }
  if (existingOrdersError) console.error('[processOrderRowsBatch] existing orders lookup error', existingOrdersError.message)
  const existingByKey = new Map((existingOrdersRaw ?? []).map((o) => [`${o.warehouse_code}|${o.order_no}|${o.original_order_date}`, o]))

  // Step 2: one bulk upsert for every order-group that isn't already in the DB. ON CONFLICT DO
  // NOTHING (ignoreDuplicates) rather than a plain insert -- a plain multi-row INSERT is one
  // atomic statement, so if even one row in it turns out to already exist (step 1 missing it for
  // any reason -- a race with a concurrent import, or an edge case in matching), the WHOLE
  // statement fails and every other genuinely-new order in this batch gets wrongly reported as
  // failed too. With DO NOTHING, only the conflicting rows are skipped (silently, by Postgres --
  // RETURNING never includes them), so they're re-looked-up explicitly below instead of guessed.
  const newGroups = groupList.filter((g) => !existingByKey.has(g.key))
  const insertedByKey = new Map<string, { order_id: string }>()
  if (newGroups.length > 0) {
    const { data: insertedOrders, error: insertError } = await admin
      .from('orders')
      .upsert(
        newGroups.map((g) => ({
          order_no: g.orderNo,
          warehouse_code: g.warehouseCode,
          original_order_date: g.originalOrderDate,
          store_code: g.storeCode,
          status: 'new',
          import_id: importId,
        })),
        { onConflict: 'warehouse_code,order_no,original_order_date', ignoreDuplicates: true },
      )
      .select('order_id, order_no, warehouse_code, original_order_date')
    if (insertError) {
      for (const g of newGroups) {
        g.lines.forEach((l) =>
          errors.push({ rowNumber: l.rowNumber, raw: l.raw, reason: `Failed to create order: ${insertError.message} — this row was NOT imported, fix and re-upload it`, severity: 'blocking' }),
        )
      }
    } else {
      for (const o of insertedOrders ?? []) insertedByKey.set(`${o.warehouse_code}|${o.order_no}|${o.original_order_date}`, o)

      // Groups DO NOTHING skipped (already exist under this exact key) never appear in
      // insertedOrders -- look them up for real and fold them into existingByKey, rather than
      // treating "not returned by the upsert" as proof the order doesn't exist.
      const stillMissing = newGroups.filter((g) => !insertedByKey.has(g.key))
      if (stillMissing.length > 0) {
        const missingWarehouseCodes = [...new Set(stillMissing.map((g) => g.warehouseCode))]
        const missingOrderNos = [...new Set(stillMissing.map((g) => g.orderNo))]
        const missingDates = [...new Set(stillMissing.map((g) => g.originalOrderDate))]
        const { data: reLookup, error: reLookupError } = await admin
          .from('orders')
          .select('order_id, order_no, warehouse_code, original_order_date, status')
          .in('warehouse_code', missingWarehouseCodes)
          .in('order_no', missingOrderNos)
          .in('original_order_date', missingDates)
          .limit(50000)
        if (reLookupError) console.error('[processOrderRowsBatch] post-upsert re-lookup error', reLookupError.message)
        for (const o of reLookup ?? []) existingByKey.set(`${o.warehouse_code}|${o.order_no}|${o.original_order_date}`, o)
      }
    }
  }

  const resolvedGroups: { group: OrderGroup; orderId: string; isNew: boolean; status: string }[] = []
  for (const g of groupList) {
    const existing = existingByKey.get(g.key)
    if (existing) {
      resolvedGroups.push({ group: g, orderId: existing.order_id, isNew: false, status: existing.status })
      continue
    }
    const inserted = insertedByKey.get(g.key)
    if (inserted) {
      resolvedGroups.push({ group: g, orderId: inserted.order_id, isNew: true, status: 'new' })
      continue
    }
    // Only reachable if the upsert itself errored (already reported above, so this group is
    // deliberately not double-reported here) or the post-upsert re-lookup still couldn't find a
    // row that DO NOTHING skipped -- either way, fail loud instead of silently reporting 0
    // orders/lines imported while actually writing nothing for this order.
    if (newGroups.includes(g) && !insertedByKey.has(g.key)) {
      const alreadyReported = errors.some((e) => e.reason.startsWith('Failed to create order:') && g.lines.some((l) => l.rowNumber === e.rowNumber))
      if (!alreadyReported) {
        g.lines.forEach((l) =>
          errors.push({
            rowNumber: l.rowNumber,
            raw: l.raw,
            reason: `Order could not be found or created (internal key mismatch after upsert) — this row was NOT imported, fix and re-upload it`,
            severity: 'blocking',
          }),
        )
      }
    }
  }

  const ordersCreated = resolvedGroups.filter((r) => r.isNew).length
  const ordersUpdated = resolvedGroups.filter((r) => !r.isNew).length

  // Step 3: one bulk upsert for every line across every order in this batch, instead of one
  // upsert per line -- this is the change that matters most at WMS Transfer Order volume.
  const lineRows: { orderId: string; rowNumber: number; raw: Record<string, string>; row: Record<string, unknown> }[] = []
  for (const { group, orderId } of resolvedGroups) {
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
      lineRows.push({
        orderId,
        rowNumber: line.rowNumber,
        raw: line.raw,
        row: {
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
      })
    }
  }

  let linesUpserted = 0
  if (lineRows.length > 0) {
    const { error: linesError } = await admin.from('order_lines').upsert(
      lineRows.map((l) => l.row),
      { onConflict: 'order_id,sku,bin_code,source_line_id' },
    )
    if (!linesError) linesUpserted = lineRows.length
    else lineRows.forEach((l) => errors.push({ rowNumber: l.rowNumber, raw: l.raw, reason: `${linesError.message} — this row was NOT imported, fix and re-upload it`, severity: 'blocking' }))
  }

  // Step 4: recompute planned_pieces/unique_sku_count for every order touched by this batch in one
  // query (re-read from the DB, not just this batch's own lines, so a partial re-upload of an
  // existing order still ends up with the correct total across old + new lines) and write all the
  // results back in one upsert. order_no/warehouse_code/original_order_date/store_code/status are
  // included only because orders has NOT NULL columns with no default that Postgres still requires
  // a value for even on the conflict-update path of an upsert -- they're each set to the row's own
  // existing/just-inserted value, not touched otherwise (import_id is deliberately omitted so an
  // existing order's original import provenance is never overwritten by a later re-upload).
  const touchedOrderIds = [...new Set(resolvedGroups.map((r) => r.orderId))]
  if (touchedOrderIds.length > 0) {
    const { data: lineAgg, error: aggError } = await admin.from('order_lines').select('order_id, sku, qty').in('order_id', touchedOrderIds).limit(50000)
    if (aggError) console.error('[processOrderRowsBatch] line aggregation error', aggError.message)
    const aggByOrder = new Map<string, { pieces: number; skus: Set<string> }>()
    for (const l of lineAgg ?? []) {
      const entry = aggByOrder.get(l.order_id) ?? { pieces: 0, skus: new Set<string>() }
      entry.pieces += Number(l.qty)
      entry.skus.add(l.sku)
      aggByOrder.set(l.order_id, entry)
    }
    const orderUpdates = resolvedGroups.map(({ group, orderId, status }) => ({
      order_id: orderId,
      order_no: group.orderNo,
      warehouse_code: group.warehouseCode,
      original_order_date: group.originalOrderDate,
      store_code: group.storeCode,
      status,
      planned_pieces: aggByOrder.get(orderId)?.pieces ?? 0,
      unique_sku_count: aggByOrder.get(orderId)?.skus.size ?? 0,
    }))
    const { error: updateError } = await admin.from('orders').upsert(orderUpdates, { onConflict: 'order_id' })
    if (updateError) console.error('[processOrderRowsBatch] order totals upsert error', updateError.message)
  }

  if (errors.length > 0) {
    await admin.from('import_errors').insert(errors.map((e) => ({ import_id: importId, row_number: e.rowNumber, raw_data: e.raw, error_reason: e.reason, severity: e.severity })))
  }

  return { ordersCreated, ordersUpdated, linesUpserted, errors }
}
