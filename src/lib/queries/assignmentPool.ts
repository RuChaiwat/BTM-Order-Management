import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './config'

export interface BacklogByDate {
  orderDate: string
  orders: number
  pieces: number
}

export interface ZoneDensity {
  zone: string
  orders: number
  sumQty: number
}

export type Band = 'green' | 'yellow' | 'red'
export type ComplexityBands = Record<Band, { count: number; sumPieces: number }>

export interface PoolOrder {
  orderId: string
  orderNo: string
  storeCode: string
  plannedPieces: number
  uniqueSkuCount: number
  band?: Band
  zones?: string[]
}

const DEFAULT_PAGE_SIZE = 15

/** Work Assignment's Criteria step 1: backlog of the assignable pool (status='new'), by Order
 * Date -- the same "aggregate in SQL, not JS" pattern as Order Pool overview (migration 0014) and
 * for the same reason: the assignable pool routinely exceeds Supabase/PostgREST's row cap. */
export async function getAssignmentBacklogByDate(db: SupabaseClient, warehouseCode: string): Promise<BacklogByDate[]> {
  const { data, error } = await db.rpc('get_new_orders_backlog_by_date', { p_warehouse_code: warehouseCode })
  if (error) console.error('[assignmentPool] backlog by date error', error.message)
  return ((data ?? []) as { order_date: string; order_count: number; sum_pieces: number }[]).map((r) => ({
    orderDate: r.order_date,
    orders: Number(r.order_count),
    pieces: Number(r.sum_pieces),
  }))
}

/** Criteria step 2: zone breakdown of that date's backlog. */
export async function getAssignmentZoneDensity(db: SupabaseClient, warehouseCode: string, orderDate: string): Promise<ZoneDensity[]> {
  const { data, error } = await db.rpc('get_new_orders_zone_density_by_date', { p_warehouse_code: warehouseCode, p_order_date: orderDate })
  if (error) console.error('[assignmentPool] zone density by date error', error.message)
  return ((data ?? []) as { zone_code: string; order_count: number; sum_qty: number }[])
    .map((r) => ({ zone: r.zone_code, orders: Number(r.order_count), sumQty: Number(r.sum_qty) }))
    .sort((a, b) => b.sumQty - a.sumQty)
}

/** Same green/red pieces-per-SKU thresholds used everywhere else in the app (Order Pool
 * overview). Shared by both the complexity band aggregate and the pool order listing below so
 * the two always classify an order the same way. */
async function getComplexityThresholds(db: SupabaseClient): Promise<{ greenMin: number; redMax: number }> {
  const cfg = await getActiveConfig(db, ['order_complexity.green_min_pcs_per_sku', 'order_complexity.red_max_pcs_per_sku'])
  return {
    greenMin: Number(cfg.value('order_complexity.green_min_pcs_per_sku') ?? 5),
    redMax: Number(cfg.value('order_complexity.red_max_pcs_per_sku') ?? 2),
  }
}

/** Criteria step 3: complexity bands for that date+zone selection. */
export async function getAssignmentComplexity(
  db: SupabaseClient,
  warehouseCode: string,
  orderDate: string,
  zoneCode: string,
): Promise<{ bands: ComplexityBands; thresholds: { greenMin: number; redMax: number } }> {
  const thresholds = await getComplexityThresholds(db)

  const { data, error } = await db.rpc('get_new_orders_complexity_by_date_zone', {
    p_warehouse_code: warehouseCode,
    p_order_date: orderDate,
    p_zone_code: zoneCode,
    p_green_min: thresholds.greenMin,
    p_red_max: thresholds.redMax,
  })
  if (error) console.error('[assignmentPool] complexity by date/zone error', error.message)

  const bands: ComplexityBands = { green: { count: 0, sumPieces: 0 }, yellow: { count: 0, sumPieces: 0 }, red: { count: 0, sumPieces: 0 } }
  for (const row of (data ?? []) as { band: Band; order_count: number; sum_pieces: number }[]) {
    bands[row.band] = { count: Number(row.order_count), sumPieces: Number(row.sum_pieces) }
  }
  return { bands, thresholds }
}

export type PoolSortColumn = 'order_no' | 'store_code' | 'unique_sku_count' | 'planned_pieces'

/** Section 2 (Unassigned Order Pool): the actual order rows for a date+zone selection, optionally
 * narrowed to one complexity band, sorted, and paginated -- all server-side (migration 0017),
 * so the header count, "Page X of Y", and the visible rows always agree with each other and with
 * the Criteria panel's own band counts, regardless of how the result is spread across pages. */
export async function getAssignmentPoolOrders(
  db: SupabaseClient,
  warehouseCode: string,
  orderDate: string,
  zoneCode: string,
  page: number,
  opts: { band?: Band | null; sort?: PoolSortColumn; sortDir?: 'asc' | 'desc'; pageSize?: number } = {},
): Promise<{ orders: PoolOrder[]; total: number }> {
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE
  const thresholds = await getComplexityThresholds(db)

  const { data, error } = await db.rpc('get_new_orders_by_date_zone', {
    p_warehouse_code: warehouseCode,
    p_order_date: orderDate,
    p_zone_code: zoneCode,
    p_green_min: thresholds.greenMin,
    p_red_max: thresholds.redMax,
    p_band: opts.band ?? null,
    p_sort: opts.sort ?? 'order_no',
    p_sort_dir: opts.sortDir ?? 'asc',
    p_limit: pageSize,
    p_offset: (page - 1) * pageSize,
  })
  if (error) console.error('[assignmentPool] pool orders error', error.message)
  const rows = (data ?? []) as { order_id: string; order_no: string; store_code: string; planned_pieces: number; unique_sku_count: number; band: Band; total_count: number }[]
  return {
    orders: rows.map((r) => ({ orderId: r.order_id, orderNo: r.order_no, storeCode: r.store_code, plannedPieces: r.planned_pieces, uniqueSkuCount: r.unique_sku_count, band: r.band })),
    total: rows[0]?.total_count ?? 0,
  }
}

/** Criteria step 4 (fallback): scan an Order Barcode directly, bypassing the date/zone drill-down.
 * Also returns which zone(s) the order's lines touch, since the client still needs exactly one
 * zone to create the Assignment Batch against (FR-030) even when the date/zone drill-down was
 * skipped entirely. */
export async function findAssignablePoolOrderByOrderNo(db: SupabaseClient, warehouseCode: string, orderNo: string): Promise<PoolOrder | null> {
  const { data, error } = await db
    .from('orders')
    .select('order_id, order_no, store_code, planned_pieces, unique_sku_count')
    .eq('warehouse_code', warehouseCode)
    .eq('status', 'new')
    .eq('order_no', orderNo.trim())
    .maybeSingle()
  if (error) console.error('[assignmentPool] scan lookup error', error.message)
  if (!data) return null

  const { data: lines } = await db.from('order_lines').select('zone_code').eq('order_id', data.order_id)
  const zones = [...new Set((lines ?? []).map((l) => l.zone_code).filter((z): z is string => Boolean(z)))]

  return { orderId: data.order_id, orderNo: data.order_no, storeCode: data.store_code, plannedPieces: data.planned_pieces, uniqueSkuCount: data.unique_sku_count, zones }
}
