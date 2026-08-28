import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProductivityData } from '@/lib/queries/productivity'

export default async function ProductivityPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const data = await getProductivityData(admin, warehouseCode)

  return (
    <AppLayout activeNavId={12}>
      <TopBar title="Productivity / SLA / Short Pick" subtitle={`ผลิตภาพ / SLA / หยิบขาด · ${data.windowDays}-day window · ${warehouseCode}`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <KpiCard label="ORDERS COMPLETED" value={data.kpis.completedOrders} compact style={{ padding: 14 }} />
          <KpiCard label="TOTAL PIECES PICKED" value={data.kpis.totalPieces} compact style={{ padding: 14 }} />
          <KpiCard label="AVG PCS / HOUR" value={data.kpis.avgPcsPerHour ?? '—'} compact style={{ padding: 14 }} />
          <KpiCard
            label="SLA COMPLIANCE"
            value={data.kpis.slaPct !== null ? `${data.kpis.slaPct}%` : '—'}
            valueColor={data.kpis.slaPct !== null && data.kpis.slaPct < 85 ? '#DC2626' : '#16A34A'}
            sub="cycle time ≤ 120 min"
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="SHORT PICK RATE"
            value={data.kpis.shortRatePct !== null ? `${data.kpis.shortRatePct}%` : '—'}
            valueColor={data.kpis.shortRatePct !== null && data.kpis.shortRatePct > 5 ? '#F59E0B' : undefined}
            compact
            style={{ padding: 14 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
          <div className="card" style={{ minHeight: 0 }}>
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Picker Productivity</span>
              <span className="card-subtitle">ranked by pcs/hour, {data.windowDays}-day window</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>PICKER</th>
                  <th>PCS / HR</th>
                  <th>ORDERS COMPLETED</th>
                  <th>SLA %</th>
                  <th>SHORT PICK RATE</th>
                </tr>
              </thead>
              <tbody>
                {data.pickerRows.map((p, i) => (
                  <tr key={p.user_id}>
                    <td>{i + 1}</td>
                    <td style={{ fontWeight: 700 }}>
                      {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.user_id})</span>
                    </td>
                    <td style={{ fontWeight: p.pcsPerHour ? 700 : 400, color: p.pcsPerHour ? undefined : '#6B7280' }}>{p.pcsPerHour ?? '—'}</td>
                    <td>{p.completed}</td>
                    <td>{p.slaPct !== null ? `${p.slaPct}%` : '—'}</td>
                    <td>{p.shortRate !== null ? `${p.shortRate}%` : '—'}</td>
                  </tr>
                ))}
                {data.pickerRows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                      No active pickers found for {warehouseCode}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ minHeight: 0 }}>
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Short Pick Reasons</span>
              <span className="card-subtitle">ranked by pieces short</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>REASON</th>
                  <th>OCCURRENCES</th>
                  <th>PIECES SHORT</th>
                </tr>
              </thead>
              <tbody>
                {data.reasonBreakdown.map((r) => (
                  <tr key={r.code}>
                    <td>{r.label}</td>
                    <td>{r.count}</td>
                    <td style={{ fontWeight: 700, color: '#F59E0B' }}>{r.shortPieces}</td>
                  </tr>
                ))}
                {data.reasonBreakdown.length === 0 && (
                  <tr>
                    <td colSpan={3} style={{ color: 'var(--color-text-secondary)' }}>
                      No short picks in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
