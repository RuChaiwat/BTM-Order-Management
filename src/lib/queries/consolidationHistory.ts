import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import { bangkokDateKey, bangkokDayRange } from '../formatDate'

export type ConsolidationHistorySearchField = 'released' | 'order_date' | 'batch_no'

export interface ConsolidationHistoryRow {
  consol_batch_id: string
  batch_no: string
  order_date: string
  priority: string
  stores_count: number
  orders_count: number
  total_pieces: number
  status: string
  released_at: string | null
  created_at: string
}

const HISTORY_STATUSES = ['report_released', 'picking', 'at_consolidation', 'sorting', 'completed', 'cancelled']

/** §Consolidation History follow-up: search by exactly one of Release Date / Order Date / Batch
 * No at a time (never combined -- keeps the filter UI to one field + one input, matching how the
 * user described it) instead of the previous flat "last 100" list with no way to reach anything
 * older. fetchAllRows (not .limit()) because a Batch No search has no date bound and could
 * plausibly match more than Supabase's default row cap across a long history. */
export async function getConsolidationHistory(
  db: SupabaseClient,
  { field, date, batchNo }: { field: ConsolidationHistorySearchField; date?: string; batchNo?: string },
): Promise<ConsolidationHistoryRow[]> {
  const columns = 'consol_batch_id, batch_no, order_date, priority, stores_count, orders_count, total_pieces, status, released_at, created_at'

  if (field === 'batch_no' && batchNo) {
    return fetchAllRows((from, to) =>
      db.from('consolidation_batches').select(columns).in('status', HISTORY_STATUSES).ilike('batch_no', `%${batchNo}%`).order('created_at', { ascending: false }).range(from, to),
    )
  }

  if (field === 'order_date' && date) {
    return fetchAllRows((from, to) =>
      db.from('consolidation_batches').select(columns).in('status', HISTORY_STATUSES).eq('order_date', date).order('created_at', { ascending: false }).range(from, to),
    )
  }

  // Default: Release Date (defaults to today -- Bangkok calendar day -- when no date is given at all).
  const { sinceIso, untilIso } = bangkokDayRange(date ?? bangkokDateKey(new Date())!)
  return fetchAllRows((from, to) =>
    db
      .from('consolidation_batches')
      .select(columns)
      .in('status', HISTORY_STATUSES)
      .gte('released_at', sinceIso)
      .lt('released_at', untilIso)
      .order('created_at', { ascending: false })
      .range(from, to),
  )
}
