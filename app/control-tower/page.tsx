import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getControlTowerData } from '@/lib/queries/controlTower'

export default async function ControlTowerPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const data = await getControlTowerData(admin, user.warehouse_code ?? 'DC002')
  const totalBacklog = data.kpis.pickingBacklog + data.kpis.verificationBacklog

  return (
    <AppLayout activeNavId={10}>
      <TopBar title="Control Tower" subtitle={`ศูนย์ควบคุม · ${user.warehouse_code ?? ''}`} />

      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          <KpiCard label="TOTAL ORDERS" value={data.kpis.totalOrders} compact style={{ padding: 14 }} />
          <KpiCard label="TOTAL BACKLOG" value={totalBacklog} valueColor="#F59E0B" sub={`Picking ${data.kpis.pickingBacklog} · Verify ${data.kpis.verificationBacklog}`} compact style={{ padding: 14 }} />
          <KpiCard label="TOTAL PIECES (PLAN)" value={data.kpis.totalPlannedPieces} compact style={{ padding: 14 }} />
          <KpiCard label="PIECES PICKED" value={data.kpis.piecesPicked} valueColor="#16A34A" compact style={{ padding: 14 }} />
          <KpiCard label="PICKER IN PROGRESS" value={data.flow.assignment} compact style={{ padding: 14 }} />
          <KpiCard label="PICKER COMPLETED" value={data.kpis.pickerCompletedCount} sub={`100% ${data.kpis.pickerCompleted100} · short ${data.kpis.pickerCompletedShort}`} compact style={{ padding: 14 }} />
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          <KpiCard label="WARNING ORDERS" value={data.secondaryKpis.warningOrders} accentColor="#F59E0B" labelColor="#B45309" valueColor="#B45309" compact style={{ padding: 14 }} />
          <KpiCard label="OVERDUE ORDERS" value={data.secondaryKpis.overdueOrders} accentColor="#EA580C" labelColor="#C2410C" valueColor="#C2410C" compact style={{ padding: 14 }} />
          <KpiCard label="CRITICAL ORDERS" value={data.secondaryKpis.criticalOrders} accentColor="#DC2626" valueColor="#DC2626" compact style={{ padding: 14 }} />
          <KpiCard label="ACTIVE PICKERS" value={data.kpis.activePickers} compact style={{ padding: 14 }} />
          <KpiCard label="PICKER COMPLETED 100%" value={data.kpis.pickerCompleted100} compact style={{ padding: 14 }} />
          <KpiCard label="PICKER COMPLETED SHORT" value={data.kpis.pickerCompletedShort} compact style={{ padding: 14 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
          <div className="card" style={{ minHeight: 0 }}>
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Zone Overview</span>
              <span className="card-subtitle">Orders Touching Zone — do not sum across zones</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ZONE</th>
                  <th>ORDERS</th>
                  <th>BACKLOG P/V</th>
                  <th>IN PROGRESS</th>
                  <th>COMPLETED</th>
                  <th>SLA</th>
                </tr>
              </thead>
              <tbody>
                {data.zoneOverview.map((z) => (
                  <tr key={z.zone}>
                    <td style={{ fontWeight: 700 }}>{z.zone}</td>
                    <td>{z.orders}</td>
                    <td>
                      {z.pickingBacklog} / {z.verificationBacklog}
                    </td>
                    <td>{z.inProgress}</td>
                    <td>{z.completed}</td>
                    <td>{z.slaPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '18px 0 10px' }}>
              <span className="card-title">Top Overdue Orders</span>
              <span className="card-subtitle">ordered by elapsed time</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>PICKER</th>
                  <th>ELAPSED</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.topOverdueOrders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="link">{o.order_no}</td>
                    <td>{o.pickerName}</td>
                    <td>{Math.round(o.alert?.elapsed_minutes ?? 0)} min</td>
                    <td>
                      <span className={`badge badge-${o.alert?.time_alert === 'critical' ? 'danger' : 'warning'}`}>{o.alert?.time_alert}</span>
                    </td>
                  </tr>
                ))}
                {data.topOverdueOrders.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                      Nothing overdue right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card" style={{ minHeight: 0 }}>
            <div className="card-header">
              <span className="card-title">Alerts &amp; Notifications</span>
              <span className="card-subtitle">การแจ้งเตือน</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
              {data.secondaryKpis.criticalOrders > 0 && <AlertRow color="#DC2626" text={`${data.secondaryKpis.criticalOrders} Critical orders`} />}
              {data.secondaryKpis.overdueOrders > 0 && <AlertRow color="#F59E0B" text={`${data.secondaryKpis.overdueOrders} Overdue orders`} />}
              {data.kpis.verificationBacklog > 0 && <AlertRow color="#2563EB" text={`Verification backlog: ${data.kpis.verificationBacklog} orders waiting`} />}
              {data.actionRequired.invalidBinCode > 0 && <AlertRow color="#6B7280" text={`${data.actionRequired.invalidBinCode} Invalid Bin Code errors in import queue`} />}
              {data.secondaryKpis.criticalOrders === 0 && data.secondaryKpis.overdueOrders === 0 && data.kpis.verificationBacklog === 0 && data.actionRequired.invalidBinCode === 0 && (
                <span style={{ color: 'var(--color-text-secondary)' }}>No active alerts.</span>
              )}
            </div>
            <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
              Total Backlog = Picking Backlog + Verification Backlog, always shown separately.
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

function AlertRow({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 5, flex: 'none' }} />
      <div style={{ flex: 1 }}>{text}</div>
    </div>
  )
}
