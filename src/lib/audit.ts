import type { SupabaseClient } from '@supabase/supabase-js'

/** Writes an immutable audit_logs row. Call from Route Handlers after a privileged write (§23). */
export async function writeAudit(
  db: SupabaseClient,
  params: {
    userId: string | null
    action: string
    entityType: string
    entityId?: string | null
    before?: unknown
    after?: unknown
  },
) {
  await db.from('audit_logs').insert({
    user_id: params.userId,
    action: params.action,
    entity_type: params.entityType,
    entity_id: params.entityId ?? null,
    before: params.before ?? null,
    after: params.after ?? null,
  })
}

/** Writes a status_history row — call whenever an entity's status field changes. */
export async function writeStatusHistory(
  db: SupabaseClient,
  params: {
    entityType: string
    entityId: string
    oldStatus: string | null
    newStatus: string
    changedBy: string | null
    reason?: string | null
  },
) {
  await db.from('status_history').insert({
    entity_type: params.entityType,
    entity_id: params.entityId,
    old_status: params.oldStatus,
    new_status: params.newStatus,
    changed_by: params.changedBy,
    reason: params.reason ?? null,
  })
}
