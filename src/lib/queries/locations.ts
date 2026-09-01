import type { SupabaseClient } from '@supabase/supabase-js'

/** Distinct Zone Codes touched by active Locations in a warehouse.
 *
 * This must NOT be a plain `select zone_code ... `: Supabase/PostgREST's project-level "Max Rows"
 * setting is a hard server-side cap (default 1000) that a client-side `.limit()` can only lower,
 * never raise. Location Master is tens of thousands of rows per warehouse and gets inserted
 * aisle-by-aisle, so a capped row-order select comes back as one aisle's worth of rows — i.e. one
 * zone — no matter what `.limit()` is requested. Instead this calls a DB-side DISTINCT aggregate
 * (see migration 0012), which returns only the handful of actual zone codes regardless of table
 * size, so it's never subject to the row cap. */
export async function getActiveZoneCodes(db: SupabaseClient, warehouseCode: string): Promise<string[]> {
  const res = await db.rpc('get_active_zone_codes', { p_warehouse_code: warehouseCode })
  if (res.error) {
    console.error('[locations] get_active_zone_codes error', res.error.message)
    return []
  }
  return ((res.data ?? []) as { zone_code: string }[]).map((r) => r.zone_code).filter(Boolean)
}
