import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Looks up each Aisle's rank in the walking order, assigning a new one (always appended to the
 * end — see migration 0011's comment on why insertion-in-the-middle isn't supported) for any
 * Aisle not already known for this warehouse. `aislesInFirstSeenOrder` should list each new Aisle
 * only once, in the order they should be appended if they're new (e.g. first-appearance order in
 * an import file) — order only matters for Aisles not already in aisle_sequence.
 */
export async function getOrAssignAisleRanks(admin: SupabaseClient, warehouseCode: string, aislesInFirstSeenOrder: string[]): Promise<Map<string, number>> {
  const { data: existing } = await admin.from('aisle_sequence').select('aisle, aisle_rank').eq('warehouse_code', warehouseCode)
  const rankByAisle = new Map<string, number>((existing ?? []).map((r) => [r.aisle, r.aisle_rank]))

  let nextRank = rankByAisle.size > 0 ? Math.max(...rankByAisle.values()) + 1 : 1
  const toInsert: { warehouse_code: string; aisle: string; aisle_rank: number }[] = []
  for (const aisle of aislesInFirstSeenOrder) {
    if (rankByAisle.has(aisle)) continue
    rankByAisle.set(aisle, nextRank)
    toInsert.push({ warehouse_code: warehouseCode, aisle, aisle_rank: nextRank })
    nextRank++
  }

  if (toInsert.length > 0) {
    const { error } = await admin.from('aisle_sequence').insert(toInsert)
    if (error) throw new Error(`Failed to assign Aisle rank: ${error.message}`)
  }

  return rankByAisle
}
