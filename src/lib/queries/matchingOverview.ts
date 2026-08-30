import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './config'
import { unwrap } from './unwrap'

/**
 * §9-11 Matching Dashboard (Mockup 1 "Order Consolidation Dashboard") — a read-only, at-a-glance
 * view of one Order Date's matching potential, so a Supervisor/Planner can decide whether to open
 * Matching Analysis & Batch Review and act, without digging through the batch table first.
 *
 * "Single Orders" here means "orders not yet linked to a batch" — the matching engine's actual
 * P5/Single routing decision is returned to the caller as an API response (app/api/matching/run)
 * and never persisted, so an order that simply hasn't been matched yet looks identical, at the DB
 * level, to one the engine evaluated and found no group for. Flagging this rather than silently
 * treating the count as exact; a persisted `orders.match_evaluated_at` (or similar) would resolve
 * it if this distinction becomes operationally important.
 */
export async function getMatchingOverviewData(db: SupabaseClient, warehouseCode: string, orderDate: string) {
  const [ordersRes, batchesRes, cfg] = await Promise.all([
    db.from('orders').select('order_id, status, planned_pieces, consolidation_batch_id').eq('warehouse_code', warehouseCode).eq('original_order_date', orderDate),
    db
      .from('consolidation_batches')
      .select('consol_batch_id, priority, match_pct, stores_count, orders_count, unique_sku_count, total_pieces, status')
      .eq('order_date', orderDate),
    getActiveConfig(db, ['matching.p4_min_pieces']),
  ])
  const orders = unwrap(ordersRes)
  const batches = unwrap(batchesRes)
  const oversizedThreshold = Number(cfg.value('matching.p4_min_pieces') ?? 150)

  const orderIds = orders.map((o) => o.order_id)
  const linesRes = orderIds.length ? await db.from('order_lines').select('order_id, zone_code').in('order_id', orderIds) : { data: [] as { order_id: string; zone_code: string | null }[] }
  const zoneOrderIds = new Map<string, Set<string>>()
  for (const l of unwrap(linesRes)) {
    if (!l.zone_code) continue
    if (!zoneOrderIds.has(l.zone_code)) zoneOrderIds.set(l.zone_code, new Set())
    zoneOrderIds.get(l.zone_code)!.add(l.order_id)
  }
  const zoneDistribution = [...zoneOrderIds.entries()].map(([zone, set]) => ({ zone, orders: set.size })).sort((a, b) => b.orders - a.orders)

  const activeOrders = orders.filter((o) => o.status !== 'cancelled')
  const matchedOrders = activeOrders.filter((o) => o.consolidation_batch_id)
  const unmatchedOrders = activeOrders.filter((o) => !o.consolidation_batch_id)
  const totalPieces = orders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
  const matchRate = activeOrders.length > 0 ? Math.round((matchedOrders.length / activeOrders.length) * 1000) / 10 : 0

  const priorityBreakdown = (['P1', 'P2', 'P3', 'P4'] as const).map((priority) => {
    const group = batches.filter((b) => b.priority === priority)
    return { priority, batches: group.length, orders: group.reduce((s, b) => s + b.orders_count, 0) }
  })
  const totalGroupedOrders = priorityBreakdown.reduce((s, p) => s + p.orders, 0) + unmatchedOrders.length

  const topBatches = [...batches].sort((a, b) => b.total_pieces - a.total_pieces).slice(0, 5)

  return {
    orderDate,
    kpis: {
      totalOrders: orders.length,
      eligibleOrders: activeOrders.length,
      matchedOrders: matchedOrders.length,
      matchRate,
      batchesCreated: batches.length,
      singleOrders: unmatchedOrders.length,
      totalPieces,
    },
    priorityBreakdown,
    totalGroupedOrders,
    zoneDistribution,
    actionRequired: {
      lowMatchRateBatches: batches.filter((b) => (b.match_pct ?? 1) < 0.5).length,
      oversizedSingleOrders: unmatchedOrders.filter((o) => (o.planned_pieces ?? 0) > oversizedThreshold).length,
      needsReview: batches.filter((b) => b.status === 'review').length,
      readyToRelease: batches.filter((b) => b.status === 'approved').length,
    },
    topBatches,
  }
}
