import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

/** Distinct Zone Codes touched by active Locations in a warehouse. Explicit high `.limit()` is
 * deliberate, not decorative — Location Master can be tens of thousands of rows, and an
 * unfiltered/unlimited select silently truncates at Supabase's default row cap (1000), which
 * previously made this list miss most zones once Location Master grew past that (same root cause
 * as the order-import Bin Code lookup bug). We only need the zone_code column, so this is cheap
 * even fetched in full. */
export async function getActiveZoneCodes(db: SupabaseClient, warehouseCode: string): Promise<string[]> {
  const res = await db.from('locations').select('zone_code').eq('warehouse_code', warehouseCode).eq('active', true).limit(200000)
  const rows = unwrap(res)
  return [...new Set(rows.map((r) => r.zone_code).filter(Boolean))].sort()
}
