import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { fetchAllRows } from './fetchAllRows'

// A consolidation batch reaching `completed` only means the physical
// consolidate/sort-for-delivery step is done for that batch -- it says nothing about whether the
// individual orders inside it have actually cleared picking + Admin Verification yet (that's a
// completely separate axis, driven by orders.status / picker_completions, not
// consolidation_batches.status). "Pending Completion" below surfaces that gap: how many of the
// orders sitting in these active batches haven't reached a final closed status yet.
const TERMINAL_CLOSED_STATUSES = new Set(['final_closed_100', 'final_closed_short'])

/** §9-11 Consolidation Pick Report — the operational worklist for batches that have been
 * released and are actively being picked/sorted at the consolidation area, distinct from
 * Consolidation History's full archive (released + completed + cancelled). Oldest release first,
 * since those are the ones sitting longest without being marked complete. */
export async function getActivePickReportBatches(db: SupabaseClient) {
  const batchesRes = await db
    .from('consolidation_batches')
    .select('consol_batch_id, batch_no, order_date, priority, stores_count, orders_count, unique_sku_count, total_pieces, status, released_at, report_generated_at')
    .in('status', ['report_released', 'picking', 'at_consolidation', 'sorting'])
    .order('released_at', { ascending: true })
  const batches = unwrap(batchesRes)

  const batchIds = batches.map((b) => b.consol_batch_id)
  const batchOrders = batchIds.length
    ? await fetchAllRows<{ order_id: string; status: string; planned_pieces: number | null }>((from, to) =>
        db.from('orders').select('order_id, status, planned_pieces').in('consolidation_batch_id', batchIds).range(from, to),
      )
    : []
  const pendingOrders = batchOrders.filter((o) => !TERMINAL_CLOSED_STATUSES.has(o.status))

  return {
    batches,
    kpis: {
      activeBatches: batches.length,
      totalPieces: batches.reduce((s, b) => s + b.total_pieces, 0),
      totalOrders: batches.reduce((s, b) => s + b.orders_count, 0),
      totalStores: batches.reduce((s, b) => s + b.stores_count, 0),
      pendingCompletionOrders: pendingOrders.length,
      pendingCompletionPieces: pendingOrders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
    },
  }
}
