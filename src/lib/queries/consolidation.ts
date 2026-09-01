import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

/**
 * Batch Review is scoped to one Order Date at a time (the same date "Run matching" runs
 * for) rather than a rolling "last 50 batches" list — Run Matching only ever touches one
 * Order Date, so a same-date review keeps the two in sync by construction instead of by
 * convention. Browsing a different date is just a different `orderDate` here.
 */
export async function getMatchingDashboardData(db: SupabaseClient, warehouseCode: string, orderDate: string) {
  const batchesRes = await db
    .from('consolidation_batches')
    .select('consol_batch_id, batch_no, order_date, priority, match_pct, stores_count, orders_count, unique_sku_count, total_pieces, status, created_at')
    .eq('order_date', orderDate)
    .order('created_at', { ascending: false })
    .limit(1000)
  const batches = unwrap(batchesRes)

  const pendingOrdersRes = await db
    .from('orders')
    .select('order_id', { count: 'exact', head: true })
    .eq('warehouse_code', warehouseCode)
    .eq('original_order_date', orderDate)
    .eq('status', 'new')
    .is('consolidation_batch_id', null)

  return { batches, unmatchedPendingCount: pendingOrdersRes.count ?? 0 }
}

/**
 * Uses the admin (service_role) client, not the caller's RLS-scoped session client — this is an
 * internal operational report (A4 pick report), not per-user personalized data, so there's no
 * reason to route it through RLS at all. requireRole-equivalent access control for this page
 * happens at the menu/nav level (§7 role-based menu visibility) instead.
 */
export async function getBatchDetail(db: SupabaseClient, batchId: string) {
  const batchRes = await db.from('consolidation_batches').select('*').eq('consol_batch_id', batchId).single()
  if (batchRes.error) console.error('[getBatchDetail] consolidation_batches error', batchRes.error.message)
  const batch = batchRes.data
  if (!batch) return null

  const ordersRes = await db.from('consolidation_orders').select('order_id, sequence').eq('consol_batch_id', batchId).order('sequence')
  const links = unwrap(ordersRes)
  const orderIds = links.map((l) => l.order_id)

  const ordersDataRes = orderIds.length
    ? await db.from('orders').select('order_id, order_no, store_code, planned_pieces, unique_sku_count, warehouse_code').in('order_id', orderIds)
    : { data: [] as { order_id: string; order_no: string; store_code: string; planned_pieces: number; unique_sku_count: number; warehouse_code: string }[] }
  const orders = unwrap(ordersDataRes)

  const linesRes = orderIds.length
    ? await db.from('order_lines').select('order_id, sku, sku_barcode, bin_code, qty, item_description, zone_code, pick_sequence').in('order_id', orderIds)
    : { data: [] as { order_id: string; sku: string; sku_barcode: string | null; bin_code: string; qty: number; item_description: string | null; zone_code: string | null; pick_sequence: string | null }[] }
  const lines = unwrap(linesRes)

  return { batch, orders, lines }
}

/** §11 grouping: SKU + Bin Code, summed across all orders in the batch, sorted by Pick Sequence.
 * Also tracks distinct Stores/Orders contributing to each line, per the report's column list. */
export function buildPickReportLines(
  lines: { order_id: string; sku: string; sku_barcode: string | null; bin_code: string; qty: number; item_description: string | null; zone_code: string | null; pick_sequence: string | null }[],
  orders: { order_id: string; store_code: string }[],
) {
  const storeByOrder = new Map(orders.map((o) => [o.order_id, o.store_code]))
  const grouped = new Map<
    string,
    {
      sku: string
      skuBarcode: string | null
      binCode: string
      qty: number
      description: string | null
      zoneCode: string | null
      pickSequence: string | null
      orderIds: Set<string>
      stores: Set<string>
    }
  >()
  for (const l of lines) {
    const key = `${l.sku}|${l.bin_code}`
    const entry =
      grouped.get(key) ??
      { sku: l.sku, skuBarcode: l.sku_barcode, binCode: l.bin_code, qty: 0, description: l.item_description, zoneCode: l.zone_code, pickSequence: l.pick_sequence, orderIds: new Set<string>(), stores: new Set<string>() }
    entry.qty += Number(l.qty)
    entry.orderIds.add(l.order_id)
    const store = storeByOrder.get(l.order_id)
    if (store) entry.stores.add(store)
    grouped.set(key, entry)
  }
  return [...grouped.values()]
    .sort((a, b) => (a.pickSequence ?? '').localeCompare(b.pickSequence ?? ''))
    .map((e) => ({ ...e, orderCount: e.orderIds.size, storeCount: e.stores.size }))
}

export type PickReportLine = ReturnType<typeof buildPickReportLines>[number]
