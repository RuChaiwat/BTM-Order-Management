import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './config'
import { fetchScopedByOrderIds } from './scopedFetch'
import { fetchAllRows } from './fetchAllRows'
import { PRINTABLE_BATCH_STATUSES } from '../matching/batchStatus'

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
  // A plain `.select()` with no `.range()` is silently capped at Supabase/PostgREST's project
  // "Max Rows" setting (see fetchAllRows's own comment) -- a busy Order Date's order count sat
  // exactly at that cap (1000) here, undercounting Total/Eligible Orders and everything derived
  // from them below once real volume passed it.
  const [orders, batches, cfg] = await Promise.all([
    fetchAllRows<{ order_id: string; status: string; planned_pieces: number | null; consolidation_batch_id: string | null }>((from, to) =>
      db.from('orders').select('order_id, status, planned_pieces, consolidation_batch_id').eq('warehouse_code', warehouseCode).eq('original_order_date', orderDate).range(from, to),
    ),
    fetchAllRows<{
      consol_batch_id: string
      batch_no: string
      priority: string
      match_pct: number | null
      stores_count: number
      orders_count: number
      unique_sku_count: number
      total_pieces: number
      status: string
    }>((from, to) =>
      db
        .from('consolidation_batches')
        .select('consol_batch_id, batch_no, priority, match_pct, stores_count, orders_count, unique_sku_count, total_pieces, status')
        .eq('order_date', orderDate)
        .range(from, to),
    ),
    getActiveConfig(db, ['matching.p4_min_pieces']),
  ])
  const oversizedThreshold = Number(cfg.value('matching.p4_min_pieces') ?? 150)

  // A plain `.in('order_id', orderIds)` puts every id in the request URL, which fails outright
  // once one Order Date has hundreds/thousands of orders -- same root cause as the Run Matching
  // bug (see migration 0024/0025's own comments), just for Zone Distribution instead. The RPC
  // sends orderIds in the POST body instead.
  const orderIds = orders.map((o) => o.order_id)
  const lines = await fetchScopedByOrderIds<{ order_id: string; zone_code: string | null }>(db, 'get_order_line_zones_by_ids', 'order_id, zone_code', orderIds)
  const zoneOrderIds = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrderIds.has(l.zone_code)) zoneOrderIds.set(l.zone_code, new Set())
    zoneOrderIds.get(l.zone_code)!.add(l.order_id)
  }
  const orderPiecesById = new Map(orders.map((o) => [o.order_id, o.planned_pieces ?? 0]))
  // Pieces, not just order count -- same "Orders/Pieces Touching Zone, don't sum across zones"
  // convention as Operations Dashboard's Zone Status / Control Tower's Zone Overview: an order
  // touching 2 zones counts its full pieces toward both, so this column isn't meant to be summed
  // down the list.
  const zoneDistribution = [...zoneOrderIds.entries()]
    .map(([zone, set]) => ({ zone, pieces: [...set].reduce((s, id) => s + (orderPiecesById.get(id) ?? 0), 0), orders: set.size }))
    .sort((a, b) => b.pieces - a.pieces)

  const activeOrders = orders.filter((o) => o.status !== 'cancelled')
  const matchedOrders = activeOrders.filter((o) => o.consolidation_batch_id)
  const unmatchedOrders = activeOrders.filter((o) => !o.consolidation_batch_id)
  const totalPieces = orders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
  const eligiblePieces = activeOrders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
  const matchedPieces = matchedOrders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
  // Two match rates on purpose: pieces is the number that actually matters for pick-floor
  // workload, but a date with a few huge orders can make that look better or worse than the
  // simpler "how many orders got matched" view, so both are shown rather than picking one.
  const matchRatePieces = eligiblePieces > 0 ? Math.round((matchedPieces / eligiblePieces) * 1000) / 10 : 0
  const matchRateOrders = activeOrders.length > 0 ? Math.round((matchedOrders.length / activeOrders.length) * 1000) / 10 : 0

  const priorityBreakdown = (['P1', 'P2', 'P3', 'P4'] as const).map((priority) => {
    const group = batches.filter((b) => b.priority === priority)
    return { priority, batches: group.length, orders: group.reduce((s, b) => s + b.orders_count, 0), pieces: group.reduce((s, b) => s + b.total_pieces, 0) }
  })
  const totalGroupedOrders = priorityBreakdown.reduce((s, p) => s + p.orders, 0) + unmatchedOrders.length

  const topBatches = [...batches].sort((a, b) => b.total_pieces - a.total_pieces).slice(0, 5)

  // Order Approved / Completed / Pending -- a batch's status only ever moves forward through the
  // pipeline (candidate/review -> approved -> picking -> at_consolidation -> sorting -> completed),
  // so "Approved" here means "has passed approval" (PRINTABLE_BATCH_STATUSES, the same set that
  // already gates the Print button -- INCLUDES completed batches, they were approved too) and
  // "Pending" is the difference: approved but not yet all the way to completed, i.e. still active
  // in the pick/consolidate/sort pipeline. Mirrors the Total -> Assigned -> Completed funnel style
  // already used on Operations Dashboard.
  const approvedBatches = batches.filter((b) => PRINTABLE_BATCH_STATUSES.has(b.status))
  const completedBatches = batches.filter((b) => b.status === 'completed')
  const approvedOrders = approvedBatches.reduce((s, b) => s + b.orders_count, 0)
  const approvedPieces = approvedBatches.reduce((s, b) => s + b.total_pieces, 0)
  const completedOrders = completedBatches.reduce((s, b) => s + b.orders_count, 0)
  const completedPieces = completedBatches.reduce((s, b) => s + b.total_pieces, 0)

  return {
    orderDate,
    kpis: {
      totalOrders: orders.length,
      totalPieces,
      eligibleOrders: activeOrders.length,
      eligiblePieces,
      matchedOrders: matchedOrders.length,
      matchedPieces,
      matchRatePieces,
      matchRateOrders,
      batchesCreated: batches.length,
      singleOrders: unmatchedOrders.length,
      approvedOrders,
      approvedPieces,
      completedOrders,
      completedPieces,
      pendingOrders: approvedOrders - completedOrders,
      pendingPieces: approvedPieces - completedPieces,
    },
    priorityBreakdown,
    totalGroupedOrders,
    zoneDistribution,
    actionRequired: {
      lowMatchRateBatches: batches.filter((b) => (b.match_pct ?? 1) < 0.5).length,
      oversizedSingleOrders: unmatchedOrders.filter((o) => (o.planned_pieces ?? 0) > oversizedThreshold).length,
      // Approve is now the batch's only review step (it replaces the old separate Approve +
      // Release actions), so "needs attention" collapses to just "still sitting as a candidate".
      awaitingApproval: batches.filter((b) => b.status === 'candidate').length,
    },
    topBatches,
  }
}
