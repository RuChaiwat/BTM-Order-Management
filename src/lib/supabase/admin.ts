import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from './types'

/**
 * Service-role client for Route Handlers only — bypasses RLS. Never import this into a
 * Client Component or anything that ships to the browser; SUPABASE_SERVICE_ROLE_KEY has no
 * NEXT_PUBLIC_ prefix specifically so Next.js refuses to bundle it client-side.
 *
 * Callers MUST check the caller's role (via `getSessionUser` in src/lib/auth.ts) before
 * performing a privileged write — this client itself enforces nothing but the FR-030
 * zone/warehouse trigger (0001_init_schema.sql), which applies regardless of which key writes.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}
