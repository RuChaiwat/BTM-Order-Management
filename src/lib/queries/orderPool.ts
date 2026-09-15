import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './config'

export type ComplexityBand = 'green' | 'yellow' | 'red'

/**
 * Order Pool overview — replaces a raw "50 most recent orders" list with two decision-support
 * breakdowns of the pending pool (status = 'new', i.e. not yet consolidated/assigned):
 *
 * 1. Zone density: which zones the pending pool's lines touch, and how much volume (order count +
 *    summed qty) is in each — same "count distinct orders touching, don't sum across zones" rule
 *    used by Control Tower / Zone Dashboard.
 * 2. Complexity band: pieces-per-SKU ratio buckets orders into how hard they'll be to pick.
 *    Green = many pieces, few SKU (grab a lot of a few items — easy). Red = few pieces, many SKU
 *    (small quantities scattered across many locations — hard, more walking). Yellow = balanced.
 *
 * Both breakdowns are computed in SQL (get_order_pool_zone_density / get_order_pool_complexity,
 * migration 0014), not by pulling every pending order/line into JS and aggregating here. A plain
 * select of either table hits the same Supabase/PostgREST project-level "Max Rows" cap already
 * root-caused for Zone Status (migration 0012) and the order-import Location Master lookup: a
 * client-side .limit() can only ever LOWER that cap, never raise it, so once the pending pool
 * passed the project's Max Rows setting, orders got silently undercounted AND Order Density by
 * Zone could come back completely empty (whichever slice of order_lines survived the truncation
 * happening not to carry enough zone-resolved rows). An RPC that aggregates server-side returns
 * only a handful of summary rows regardless of pool size, so it's immune to the cap by
 * construction. totalOrders uses a head-only count query for the same reason -- counting doesn't
 * transfer rows, so it isn't subject to the row cap either.
 */
export async function getOrderPoolOverview(db: SupabaseClient, warehouseCode: string) {
  const [countRes, zoneRes, cfg] = await Promise.all([
    db.from('orders').select('order_id', { count: 'exact', head: true }).eq('warehouse_code', warehouseCode).eq('status', 'new'),
    db.rpc('get_order_pool_zone_density', { p_warehouse_code: warehouseCode }),
    getActiveConfig(db, ['order_complexity.green_min_pcs_per_sku', 'order_complexity.red_max_pcs_per_sku']),
  ])
  if (countRes.error) console.error('[orderPool] orders count error', countRes.error.message)
  if (zoneRes.error) console.error('[orderPool] zone density RPC error', zoneRes.error.message)
  const greenMinPcsPerSku = Number(cfg.value('order_complexity.green_min_pcs_per_sku') ?? 5)
  const redMaxPcsPerSku = Number(cfg.value('order_complexity.red_max_pcs_per_sku') ?? 2)

  const bandRes = await db.rpc('get_order_pool_complexity', { p_warehouse_code: warehouseCode, p_green_min: greenMinPcsPerSku, p_red_max: redMaxPcsPerSku })
  if (bandRes.error) console.error('[orderPool] complexity RPC error', bandRes.error.message)

  const zoneDensity = ((zoneRes.data ?? []) as { zone_code: string; order_count: number; sum_qty: number }[])
    .map((z) => ({ zone: z.zone_code, orderCount: Number(z.order_count), sumQty: Number(z.sum_qty) }))
    .sort((a, b) => b.sumQty - a.sumQty)

  const bands: Record<ComplexityBand, { count: number; sumPieces: number }> = {
    green: { count: 0, sumPieces: 0 },
    yellow: { count: 0, sumPieces: 0 },
    red: { count: 0, sumPieces: 0 },
  }
  for (const row of (bandRes.data ?? []) as { band: ComplexityBand; order_count: number; sum_pieces: number }[]) {
    bands[row.band] = { count: Number(row.order_count), sumPieces: Number(row.sum_pieces) }
  }

  return { totalOrders: countRes.count ?? 0, zoneDensity, bands, thresholds: { greenMinPcsPerSku, redMaxPcsPerSku } }
}
