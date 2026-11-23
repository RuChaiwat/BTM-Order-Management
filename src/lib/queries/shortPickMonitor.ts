import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchCompletionsInRange, inChunks } from './rangeFetch'
import { bangkokDayRange } from '../formatDate'

export interface ShortPickDetailRow {
  lineId: string
  orderId: string
  orderNo: string
  storeCode: string
  warehouseCode: string
  zoneCode: string
  sku: string
  barcode: string | null
  itemDescription: string | null
  binCode: string
  reasonCode: string
  reasonLabelEn: string
  reasonLabelTh: string
  orderedQty: number
  pickedQty: number
  shortQty: number
  remark: string | null
  recordedAt: string
}

/**
 * Item-level short-pick detail (SKU, zone, reason, short qty) for a given set of picker
 * completions. Reason detail only exists in `picker_completion_lines`, written at Admin
 * Verification's Final Close (app/api/admin-verifications/route.ts) -- never at the picker's own
 * coarse submission (§12.2) -- so, same as Productivity's own Short Pick Reasons table, an order
 * the picker just completed but Admin hasn't verified yet won't appear here until Admin catches up.
 * `completions` is passed in (not re-queried) so every caller filters "which completions" exactly
 * once, by whatever window makes sense for it (a single day, a weekly export period, etc).
 * `warehouseCode` narrows to one warehouse (the Monitor page); omit it for a cross-warehouse caller
 * (the weekly export, which was never itself scoped to one warehouse -- see its own comment).
 */
export async function getShortPickDetailRows(
  db: SupabaseClient,
  warehouseCode: string | undefined,
  completions: { completion_id: string; order_id: string }[],
): Promise<ShortPickDetailRow[]> {
  if (completions.length === 0) return []
  const orderIdByCompletion = new Map(completions.map((c) => [c.completion_id, c.order_id]))
  const completionIds = completions.map((c) => c.completion_id)

  const shortLines = await inChunks<{ line_id: string; completion_id: string; ordered_qty: number; picked_qty: number; short_reason_code: string | null; remark: string | null; created_at: string }>(
    completionIds,
    (c) => db.from('picker_completion_lines').select('line_id, completion_id, ordered_qty, picked_qty, short_reason_code, remark, created_at').in('completion_id', c).eq('is_short', true),
  )
  if (shortLines.length === 0) return []

  const orderLines = await inChunks<{ line_id: string; sku: string; sku_barcode: string | null; item_description: string | null; bin_code: string; zone_code: string | null }>(
    shortLines.map((l) => l.line_id),
    (c) => db.from('order_lines').select('line_id, sku, sku_barcode, item_description, bin_code, zone_code').in('line_id', c),
  )
  const orderLineByLineId = new Map(orderLines.map((ol) => [ol.line_id, ol]))

  const orders = await inChunks<{ order_id: string; order_no: string; store_code: string; warehouse_code: string }>(
    [...new Set(shortLines.map((l) => orderIdByCompletion.get(l.completion_id) ?? ''))],
    (c) => db.from('orders').select('order_id, order_no, store_code, warehouse_code').in('order_id', c),
  )
  const orderById = new Map(orders.map((o) => [o.order_id, o]))

  const reasonCodes = [...new Set(shortLines.map((l) => l.short_reason_code).filter(Boolean))] as string[]
  const { data: reasons } = reasonCodes.length
    ? await db.from('reason_master').select('reason_code, label_en, label_th').in('reason_code', reasonCodes)
    : { data: [] as { reason_code: string; label_en: string; label_th: string }[] }
  const reasonByCode = new Map((reasons ?? []).map((r) => [r.reason_code, r]))

  const rows: ShortPickDetailRow[] = []
  for (const l of shortLines) {
    const orderId = orderIdByCompletion.get(l.completion_id)
    const order = orderId ? orderById.get(orderId) : undefined
    if (!order) continue
    if (warehouseCode && order.warehouse_code !== warehouseCode) continue
    const ol = orderLineByLineId.get(l.line_id)
    const reason = l.short_reason_code ? reasonByCode.get(l.short_reason_code) : null
    rows.push({
      lineId: l.line_id,
      orderId: order.order_id,
      orderNo: order.order_no,
      storeCode: order.store_code,
      warehouseCode: order.warehouse_code,
      zoneCode: ol?.zone_code ?? '—',
      sku: ol?.sku ?? '—',
      barcode: ol?.sku_barcode ?? null,
      itemDescription: ol?.item_description ?? null,
      binCode: ol?.bin_code ?? '—',
      reasonCode: l.short_reason_code ?? 'UNSPECIFIED',
      reasonLabelEn: reason?.label_en ?? l.short_reason_code ?? 'Unspecified',
      reasonLabelTh: reason?.label_th ?? l.short_reason_code ?? 'ไม่ระบุ',
      orderedQty: Number(l.ordered_qty),
      pickedQty: Number(l.picked_qty),
      shortQty: Number(l.ordered_qty) - Number(l.picked_qty),
      remark: l.remark,
      recordedAt: l.created_at,
    })
  }
  return rows
}

type Bar = { key: string; count: number; pieces: number }

export interface PickingIssueDashboardData {
  from: string
  to: string
  rows: ShortPickDetailRow[]
  zones: string[]
  kpis: {
    pickedOrders: number
    pickedPieces: number
    shortOrders: number
    shortPieces: number
    shortOrderRatePct: number | null
    shortPieceRatePct: number | null
  }
  byReason: Bar[]
  byZone: Bar[]
  byPicker: Bar[]
  bySku: Bar[]
  byLocation: Bar[]
}

/** Picking Issue Dashboard -- short picks for a date range (Bangkok calendar), keyed off the
 * picker's own confirm date (picker_completed_time) like Picking Productivity. Short detail only
 * exists once Admin has Final Closed the order (see getShortPickDetailRows).
 *   Short order rate  = orders with a short item / orders the pickers completed in the range
 *   Short pieces rate = short pieces / ordered pieces of those orders */
export async function getPickingIssueDashboard(db: SupabaseClient, warehouseCode: string, from: string, to: string): Promise<PickingIssueDashboardData> {
  // Only the range's completions, with their order fields (migration 0041).
  const inRange = await fetchCompletionsInRange(db, warehouseCode, bangkokDayRange(from).sinceIso, bangkokDayRange(to).untilIso)
  const orders = inRange
  const rows = await getShortPickDetailRows(db, warehouseCode, inRange)

  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const pickedPieces = inRange.reduce((s, c) => s + (orderById.get(c.order_id)?.planned_pieces ?? 0), 0)
  const shortOrderIds = new Set(rows.map((r) => r.orderId))
  const shortPieces = rows.reduce((s, r) => s + r.shortQty, 0)
  const pct = (n: number, d: number) => (d > 0 ? Math.round((n / d) * 1000) / 10 : null)

  // Picker of each short order (assignment batch -> picker).
  const batchIds = [...new Set([...shortOrderIds].map((id) => orderById.get(id)?.assignment_batch_id ?? ''))]
  const batches = await inChunks<{ assignment_batch_id: string; picker_id: string | null }>(batchIds, (c) =>
    db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', c),
  )
  const pickerOfBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))
  const pickers = await inChunks<{ picker_id: string; name_en: string; name_th: string | null }>(
    batches.map((b) => b.picker_id ?? ''),
    (c) => db.from('pickers').select('picker_id, name_en, name_th').in('picker_id', c),
  )
  const pickerName = new Map(pickers.map((p) => [p.picker_id, p.name_th || p.name_en]))
  const pickerLabel = (orderId: string) => {
    const batchId = orderById.get(orderId)?.assignment_batch_id
    const id = batchId ? pickerOfBatch.get(batchId) : null
    return id ? `${pickerName.get(id) ?? id} (${id})` : 'ไม่ระบุ'
  }

  // count = items (lines), or orders for By picker; pieces = short pieces.
  const tally = (keyOf: (r: ShortPickDetailRow) => string, countOrders = false, top?: number) => {
    const m = new Map<string, { count: number; pieces: number; orders: Set<string> }>()
    for (const r of rows) {
      const k = keyOf(r)
      const cur = m.get(k) ?? { count: 0, pieces: 0, orders: new Set<string>() }
      cur.count++
      cur.pieces += r.shortQty
      cur.orders.add(r.orderId)
      m.set(k, cur)
    }
    const list = [...m.entries()]
      .map(([key, v]) => ({ key, count: countOrders ? v.orders.size : v.count, pieces: v.pieces }))
      .sort((a, b) => b.count - a.count || b.pieces - a.pieces)
    return top ? list.slice(0, top) : list
  }

  return {
    from,
    to,
    rows,
    zones: [...new Set(rows.map((r) => r.zoneCode))].sort(),
    kpis: {
      pickedOrders: inRange.length,
      pickedPieces,
      shortOrders: shortOrderIds.size,
      shortPieces,
      shortOrderRatePct: pct(shortOrderIds.size, inRange.length),
      shortPieceRatePct: pct(shortPieces, pickedPieces),
    },
    byReason: tally((r) => r.reasonLabelTh),
    byZone: tally((r) => r.zoneCode),
    byPicker: tally((r) => pickerLabel(r.orderId), true, 15),
    bySku: tally((r) => { const code = r.barcode || `SKU ${r.sku}`; return r.itemDescription ? `${code} · ${r.itemDescription}` : code }, false, 15),
    byLocation: tally((r) => r.binCode, false, 15),
  }
}
