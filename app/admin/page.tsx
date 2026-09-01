import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { ReasonMasterManager } from '@/components/admin/ReasonMasterManager'
import { ConfigEditor } from '@/components/admin/ConfigEditor'
import { HousekeepingPanel } from '@/components/admin/HousekeepingPanel'
import { createAdminClient } from '@/lib/supabase/admin'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const admin = createAdminClient()

  const [
    { data: reasons, error: reasonsError },
    { data: configs, error: configsError },
    { data: auditLogs, error: auditError },
    { data: exportJobs, error: exportError },
    { data: purgeLog, error: purgeError },
  ] = await Promise.all([
    admin.from('reason_master').select('reason_code, reason_type, label_en, label_th, active').order('reason_type').order('reason_code'),
    admin.from('configuration').select('key, value, version').eq('active', true).order('key'),
    admin.from('audit_logs').select('id, user_id, action, entity_type, entity_id, created_at').order('created_at', { ascending: false }).limit(30),
    admin.from('export_jobs').select('id, status, period_start, period_end, row_count, target_ref, finished_at, error_detail').order('created_at', { ascending: false }).limit(10),
    admin.from('purge_log').select('id, covered_period_start, table_name, rows_purged, result, created_at').order('created_at', { ascending: false }).limit(20),
  ])
  for (const [label, err] of [
    ['reason_master', reasonsError],
    ['configuration', configsError],
    ['audit_logs', auditError],
    ['export_jobs', exportError],
    ['purge_log', purgeError],
  ] as const) {
    if (err) console.error(`[admin] ${label} error`, err.message)
  }

  return (
    <AppLayout activeNavId={15}>
      <TopBar title="Configuration / Audit" subtitle="ตั้งค่า / ตรวจสอบ · Reason Master, thresholds, audit trail" />
      <div className="page-body">
        <ReasonMasterManager reasons={reasons ?? []} />
        <ConfigEditor configs={configs ?? []} />
        <HousekeepingPanel exportJobs={exportJobs ?? []} purgeLog={purgeLog ?? []} />

        <div className="card" style={{ flex: 1, minHeight: 0 }}>
          <div className="card-title">Audit Trail</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            Last 30 recorded actions (§23) — immutable, System Admin / Warehouse Manager only
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>TIME</th>
                <th>USER</th>
                <th>ACTION</th>
                <th>ENTITY</th>
              </tr>
            </thead>
            <tbody>
              {(auditLogs ?? []).map((a) => (
                <tr key={a.id}>
                  <td>{new Date(a.created_at).toLocaleString()}</td>
                  <td>{a.user_id ?? 'system'}</td>
                  <td>{a.action}</td>
                  <td>
                    {a.entity_type}
                    {a.entity_id ? ` · ${a.entity_id}` : ''}
                  </td>
                </tr>
              ))}
              {(!auditLogs || auditLogs.length === 0) && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                    No audit records yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}
