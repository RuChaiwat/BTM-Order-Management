import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

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
  return { batches }
}
