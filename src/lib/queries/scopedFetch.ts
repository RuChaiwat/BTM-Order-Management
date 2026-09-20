import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'

/**
 * order_alerts/picker_completions have no warehouse_code column, so a plain `.select()` scoped to
 * this warehouse's orders used to mean either an unbounded `.in('order_id', orderIds)` (fails past
 * a few thousand ids -- PostgREST puts an .in() filter's values in the URL, which has a practical
 * length limit) or fetching the whole table and filtering in JS (correct, but re-transfers
 * unrelated rows on every page load, see migration 0022's own comment). An RPC call sends its
 * arguments in the POST body instead of the URL, so it can be scoped AND stay small -- this pages
 * through the RPC result exactly like any other query (immune to the separate Max Rows cap,
 * migration 0012), requesting only the given `columns` so each caller keeps its existing shape.
 */
export async function fetchScopedByOrderIds<T>(db: SupabaseClient, rpcName: 'get_order_alerts_by_ids' | 'get_picker_completions_by_ids', columns: string, orderIds: string[]): Promise<T[]> {
  if (orderIds.length === 0) return []
  // The client isn't given a generated Database type, so a custom RPC's row shape can't be
  // inferred (same reason every other .rpc() call in this codebase goes through `unwrap`/a loose
  // cast rather than a typed builder) -- the real shape is whatever `columns` asks for, asserted
  // by the caller's own type parameter.
  return fetchAllRows<T>(
    (from, to) => db.rpc(rpcName, { p_order_ids: orderIds }).select(columns).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  )
}
