import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Matching Dashboard and Matching Analysis & Batch Review both used to default their Order Date
 * filter to a hardcoded "yesterday" when no `?date=` was in the URL -- fine for daily production
 * use, but it silently landed on an empty day (and looked broken) whenever the orders actually
 * being tested/reviewed were imported for an older date, e.g. UAT test data. Defaulting to the
 * most recent Order Date that actually has orders for this warehouse means a fresh visit to either
 * page always opens on real data if there is any, and only falls back to "yesterday" if the
 * warehouse genuinely has no orders at all yet.
 */
export async function getMostRecentOrderDate(db: SupabaseClient, warehouseCode: string): Promise<string | null> {
  const { data } = await db
    .from('orders')
    .select('original_order_date')
    .eq('warehouse_code', warehouseCode)
    .order('original_order_date', { ascending: false })
    .limit(1)
  return data?.[0]?.original_order_date ?? null
}
