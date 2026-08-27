import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { ReasonMasterManager } from '@/components/admin/ReasonMasterManager'
import { ConfigEditor } from '@/components/admin/ConfigEditor'
import { createClient } from '@/lib/supabase/server'

export default async function AdminPage() {
  const supabase = await createClient()

  const [{ data: reasons }, { data: configs }, { data: auditLogs }] = await Promise.all([
    supabase.from('reason_master').select('reason_code, reason_type, label_en, label_th, active').order('reason_type').order('reason_code'),
    supabase.from('configuration').select('key, value, version').eq('active', true).order('key'),
    supabase.from('audit_logs').select('id, user_id, action, entity_type, entity_id, created_at').order('created_at', { ascending: false }).limit(30),
  ])

  return (
    <AppLayout activeNavId={15}>
      <TopBar title="Configuration / Audit" subtitle="ตั้งค่า / ตรวจสอบ · Reason Master, thresholds, audit trail" />
      <div className="page-body">
        <ReasonMasterManager reasons={reasons ?? []} />
        <ConfigEditor configs={configs ?? []} />

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
