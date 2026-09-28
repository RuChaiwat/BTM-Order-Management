import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import { bangkokDateKey } from '../formatDate'

export interface AuditLogRow {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  created_at: string
}

/** §23 Audit Trail, browsable by (Bangkok-calendar) day. audit_logs is purged on the same
 * retention.transaction_days cutoff as every other transactional table (app/api/cron/purge), so
 * only that many days back are actually selectable here -- a day past the cutoff simply comes
 * back empty. Fetched in full and bucketed by day in JS rather than a server-side date-range
 * filter -- the same trade-off Productivity's own day view makes, reasonable at this retention
 * window's data volume (a handful of days, not history stretching back indefinitely). */
export async function getAuditTrail(db: SupabaseClient, date: string): Promise<AuditLogRow[]> {
  const rows = await fetchAllRows<AuditLogRow>((from, to) =>
    db.from('audit_logs').select('id, user_id, action, entity_type, entity_id, created_at').order('created_at', { ascending: false }).range(from, to),
  )
  return rows.filter((r) => bangkokDateKey(r.created_at) === date)
}
