import type { SupabaseClient } from '@supabase/supabase-js'

/** Reads the currently-active value + version for each requested config key (§17 governance). */
export async function getActiveConfig(db: SupabaseClient, keys: string[], scope = 'global') {
  const { data } = await db.from('configuration').select('key, value, version').in('key', keys).eq('scope', scope).eq('active', true)
  const map = new Map((data ?? []).map((c) => [c.key, c]))
  return {
    value: (key: string) => map.get(key)?.value,
    version: (key: string) => map.get(key)?.version ?? 1,
    maxVersion: () => Math.max(1, ...[...map.values()].map((c) => c.version)),
  }
}

export const MATCHING_CONFIG_KEYS = [
  'consolidation.max_unique_sku',
  'matching.p1_min_pieces',
  'matching.p2_match_pct',
  'matching.p2_min_pieces',
  'matching.p3_match_pct',
  'matching.p3_min_pieces',
  'matching.p4_match_pct',
  'matching.p4_min_pieces',
  'consolidation.min_stores',
  'consolidation.target_stores',
  'consolidation.max_stores',
  'consolidation.max_orders',
]
