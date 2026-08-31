import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './config'
import { unwrap } from './unwrap'

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
 */
export async function getOrderPoolOverview(db: SupabaseClient, warehouseCode: string) {
  const [ordersRes, cfg] = await Promise.all([
    db.from('orders').select('order_id, planned_pieces, unique_sku_count').eq('warehouse_code', warehouseCode).eq('status', 'new'),
    getActiveConfig(db, ['order_complexity.green_min_pcs_per_sku', 'order_complexity.red_max_pcs_per_sku']),
  ])
  const orders = unwrap(ordersRes)
  const greenMinPcsPerSku = Number(cfg.value('order_complexity.green_min_pcs_per_sku') ?? 5)
  const redMaxPcsPerSku = Number(cfg.value('order_complexity.red_max_pcs_per_sku') ?? 2)

  const orderIds = orders.map((o) => o.order_id)
  const linesRes = orderIds.length
    ? await db.from('order_lines').select('order_id, zone_code, qty').in('order_id', orderIds)
    : { data: [] as { order_id: string; zone_code: string | null; qty: number }[] }
  const lines = unwrap(linesRes)

  const zoneStats = new Map<string, { orders: Set<string>; sumQty: number }>()
  for (const l of lines) {
    if (!l.zone_code) continue
    const entry = zoneStats.get(l.zone_code) ?? { orders: new Set<string>(), sumQty: 0 }
    entry.orders.add(l.order_id)
    entry.sumQty += Number(l.qty)
    zoneStats.set(l.zone_code, entry)
  }
  const zoneDensity = [...zoneStats.entries()]
    .map(([zone, e]) => ({ zone, orderCount: e.orders.size, sumQty: e.sumQty }))
    .sort((a, b) => b.sumQty - a.sumQty)

  const bands: Record<ComplexityBand, { count: number; sumSku: number }> = {
    green: { count: 0, sumSku: 0 },
    yellow: { count: 0, sumSku: 0 },
    red: { count: 0, sumSku: 0 },
  }
  for (const o of orders) {
    const uniqueSku = o.unique_sku_count || 0
    const pcsPerSku = uniqueSku > 0 ? o.planned_pieces / uniqueSku : 0
    const band: ComplexityBand = uniqueSku === 0 ? 'yellow' : pcsPerSku >= greenMinPcsPerSku ? 'green' : pcsPerSku <= redMaxPcsPerSku ? 'red' : 'yellow'
    bands[band].count += 1
    bands[band].sumSku += uniqueSku
  }

  return { totalOrders: orders.length, zoneDensity, bands, thresholds: { greenMinPcsPerSku, redMaxPcsPerSku } }
}
