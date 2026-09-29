import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import { bangkokDateKey } from '../formatDate'
import { actionMeta, auditDetail, type AuditLookups } from '../auditCatalog'

interface RawAuditLogRow {
  id: string
  user_id: string | null
  action: string
  entity_type: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
  created_at: string
}

export interface AuditTrailRow {
  id: string
  created_at: string
  user_id: string | null
  actionLabelEn: string
  actionLabelTh: string
  detail: string
}

/** §23 Audit Trail, browsable by (Bangkok-calendar) day. audit_logs is purged on the same
 * retention.transaction_days cutoff as every other transactional table (app/api/cron/purge), so
 * only that many days back are actually selectable here -- a day past the cutoff simply comes
 * back empty. Fetched in full and bucketed by day in JS rather than a server-side date-range
 * filter -- the same trade-off Productivity's own day view makes, reasonable at this retention
 * window's data volume (a handful of days, not history stretching back indefinitely).
 *
 * Raw rows (action string + entity_type/entity_id + before/after JSON) are turned into a
 * bilingual action label and a one-line plain-English detail here -- see auditCatalog.ts -- so the
 * page never has to show "configuration.update / configuration · 32a79a66-..." to an Admin who
 * has no reason to know what those mean. */
export async function getAuditTrail(db: SupabaseClient, date: string): Promise<AuditTrailRow[]> {
  const allRows = await fetchAllRows<RawAuditLogRow>((from, to) =>
    db.from('audit_logs').select('id, user_id, action, entity_type, entity_id, before, after, created_at').order('created_at', { ascending: false }).range(from, to),
  )
  const rows = allRows.filter((r) => bangkokDateKey(r.created_at) === date)

  const orderIds = [...new Set(rows.filter((r) => r.entity_type === 'orders' && r.entity_id).map((r) => r.entity_id as string))]
  const batchIds = [...new Set(rows.filter((r) => r.entity_type === 'consolidation_batches' && r.entity_id).map((r) => r.entity_id as string))]

  const [ordersRes, batchesRes] = await Promise.all([
    orderIds.length ? db.from('orders').select('order_id, order_no').in('order_id', orderIds) : Promise.resolve({ data: [] as { order_id: string; order_no: string }[] }),
    batchIds.length
      ? db.from('consolidation_batches').select('consol_batch_id, batch_no').in('consol_batch_id', batchIds)
      : Promise.resolve({ data: [] as { consol_batch_id: string; batch_no: string }[] }),
  ])
  const lookups: AuditLookups = {
    orderNoById: new Map((ordersRes.data ?? []).map((o) => [o.order_id, o.order_no])),
    batchNoById: new Map((batchesRes.data ?? []).map((b) => [b.consol_batch_id, b.batch_no])),
  }

  return rows.map((r) => {
    const meta = actionMeta(r.action)
    return {
      id: r.id,
      created_at: r.created_at,
      user_id: r.user_id,
      actionLabelEn: meta.labelEn,
      actionLabelTh: meta.labelTh,
      detail: auditDetail(r, lookups),
    }
  })
}
