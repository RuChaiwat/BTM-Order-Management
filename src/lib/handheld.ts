import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './queries/config'
import { HANDHELD_IDLE_DEFAULT, HANDHELD_IDLE_KEY } from './configCatalog'

/** Configuration > Handheld > return to menu when idle, in minutes (default 60, 0 = off, max 480). */
export async function getHandheldIdleMinutes(db: SupabaseClient): Promise<number> {
  const raw = (await getActiveConfig(db, [HANDHELD_IDLE_KEY])).value(HANDHELD_IDLE_KEY)
  const n = Number(raw)
  return raw !== undefined && raw !== null && Number.isFinite(n) && n >= 0 ? Math.min(480, Math.round(n)) : HANDHELD_IDLE_DEFAULT
}
