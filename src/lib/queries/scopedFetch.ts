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
export async function fetchScopedByOrderIds<T>(
  db: SupabaseClient,
  rpcName: 'get_order_alerts_by_ids' | 'get_picker_completions_by_ids' | 'get_order_lines_by_ids',
  columns: string,
  orderIds: string[],
): Promise<T[]> {
  if (orderIds.length === 0) return []
  // The client isn't given a generated Database type, so a custom RPC's row shape can't be
  // inferred (same reason every other .rpc() call in this codebase goes through `unwrap`/a loose
  // cast rather than a typed builder) -- the real shape is whatever `columns` asks for, asserted
  // by the caller's own type parameter.
  return fetchAllRows<T>(
    (from, to) => db.rpc(rpcName, { p_order_ids: orderIds }).select(columns).range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  )
}

export interface OrderZoneTouch {
  order_id: string
  zone_code: string
}

/**
 * order_lines is the single largest table in this schema (an order's WMS export can carry many
 * more lines than orders) -- pulling every line just to learn which zone(s) an order touches
 * (order_id, zone_code only) transfers far more rows than needed once real volume accumulates.
 * get_order_zone_touches (migration 0023) aggregates that server-side to DISTINCT (order_id,
 * zone_code) pairs, the same way get_order_pool_zone_density (migration 0014) does for the Order
 * Pool overview.
 */
export async function fetchOrderZoneTouches(db: SupabaseClient, warehouseCode: string): Promise<OrderZoneTouch[]> {
  return fetchAllRows<OrderZoneTouch>(
    (from, to) => db.rpc('get_order_zone_touches', { p_warehouse_code: warehouseCode }).range(from, to) as unknown as PromiseLike<{ data: OrderZoneTouch[] | null; error: { message: string } | null }>,
  )
}
