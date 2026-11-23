import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'

/** A picker completion with the order fields the productivity / issue pages use. */
export interface RangeCompletion {
  completion_id: string
  order_id: string
  actual_pieces: number | null
  result: string
  picker_completed_time: string
  planned_pieces: number | null
  assigned_time: string | null
  assignment_batch_id: string | null
  consolidation_batch_id: string | null
  status: string
}

/** Completions confirmed in [sinceIso, untilIso) for one warehouse (migration 0041) -- the database
 * does the date filter, so the cost follows the range asked for, not the whole history kept. */
export function fetchCompletionsInRange(db: SupabaseClient, warehouseCode: string, sinceIso: string, untilIso: string): Promise<RangeCompletion[]> {
  return fetchAllRows<RangeCompletion>(
    (from, to) =>
      db.rpc('get_completions_in_range', { p_warehouse_code: warehouseCode, p_from: sinceIso, p_to: untilIso }).range(from, to) as unknown as PromiseLike<{
        data: RangeCompletion[] | null
        error: { message: string } | null
      }>,
  )
}

/** Orders that left the workflow: admin Final Closed, or cancelled. */
export const DONE_STATUSES = ['final_closed_100', 'final_closed_short', 'cancelled'] as const

/** PostgREST `.or()` filter for the daily dashboards: every order still in the workflow, plus
 * orders closed (pack_ready_at = Final Close time) or imported since `sinceIso`. Old finished
 * orders -- the bulk of a 60-day history -- are never read. */
export function openOrSinceFilter(sinceIso: string): string {
  return `status.not.in.(${DONE_STATUSES.join(',')}),pack_ready_at.gte."${sinceIso}",created_at.gte."${sinceIso}"`
}

const CHUNK = 150

/** `.in()` lookups in chunks so no PostgREST URL grows past its limit. */
export async function inChunks<T>(ids: string[], fetchChunk: (chunk: string[]) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = []
  const unique = [...new Set(ids.filter(Boolean))]
  for (let i = 0; i < unique.length; i += CHUNK) {
    const { data } = await fetchChunk(unique.slice(i, i + CHUNK))
    out.push(...(data ?? []))
  }
  return out
}
