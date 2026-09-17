import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getControlTowerData } from '@/lib/queries/controlTower'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

const ZONE_ROW_STYLE: Record<string, { background?: string }> = {
  critical: { background: 'var(--color-danger-bg)' },
  overdue: { background: '#FFF7ED' },
  warning: { background: 'var(--color-warning-bg)' },
  none: {},
}

export default async function ControlTowerPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const data = await getControlTowerData(admin, user.warehouse_code ?? 'DC002')

  return (
    <AppLayout activeNavId={10}>
      <TopBar title="Control Tower" subtitle={`ศูนย์ควบคุม · ${user.warehouse_code ?? ''}`} />

      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          <KpiCard
            label="TOTAL ORDERS (PCS)"
            value={data.kpis.totalPlannedPieces.toLocaleString()}
            sub={`${data.kpis.totalOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="ORDERS COMPLETED (PCS)"
            value={data.kpis.completedPieces.toLocaleString()}
            valueColor="#16A34A"
            sub={`${data.kpis.completedOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="% COMPLETED"
            value={`${data.kpis.pctPiecesCompleted}%`}
            valueColor={data.kpis.pctPiecesCompleted >= 85 ? '#16A34A' : data.kpis.pctPiecesCompleted >= 60 ? '#F59E0B' : '#DC2626'}
            sub={`Completed ${data.kpis.completedPieces.toLocaleString()} · Issue ${data.kpis.issuePieces.toLocaleString()}`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="TOTAL BACKLOG (PCS)"
            value={data.kpis.totalBacklogPieces.toLocaleString()}
            valueColor={data.kpis.totalBacklogPieces > 0 ? '#F59E0B' : undefined}
            sub={`${data.kpis.totalBacklogOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="ORDERS ASSIGNED (PCS)"
            value={data.kpis.assignedPieces.toLocaleString()}
            sub={`${data.kpis.assignedOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="ACTIVE PICKERS (PCS)"
            value={data.kpis.activePickerTotalPieces.toLocaleString()}
            sub={`${data.kpis.activePickerTotalOrders.toLocaleString()} orders in hand`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard label="WARNING ORDERS" value={data.secondaryKpis.warningOrders} accentColor="#F59E0B" labelColor="#B45309" valueColor="#B45309" compact style={{ padding: 14, textAlign: 'center' }} />
          <KpiCard label="OVERDUE ORDERS" value={data.secondaryKpis.overdueOrders} accentColor="#EA580C" labelColor="#C2410C" valueColor="#C2410C" compact style={{ padding: 14, textAlign: 'center' }} />
          <KpiCard label="CRITICAL ORDERS" value={data.secondaryKpis.criticalOrders} accentColor="#DC2626" valueColor="#DC2626" compact style={{ padding: 14, textAlign: 'center' }} />
          <KpiCard
            label="PENDING CONFIRMATION (PCS)"
            value={data.kpis.waitingVerifyPieces.toLocaleString()}
            valueColor={data.kpis.waitingVerifyPieces > 0 ? '#2563EB' : undefined}
            sub={`${data.kpis.waitingVerifyOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
        </div>

        {/* No minHeight:0 anywhere below -- .app-shell is a fixed 100vh flex column with
            overflow:hidden, so a flex item allowed to shrink below its content gets squeezed by the
            flex algorithm once total page content exceeds the viewport, and a table's overflow rows
            spill visually into the next card instead of the page just scrolling (see the same fix
            on Zone Dashboard). */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.35fr 1fr', gap: 14, flex: 1 }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Zone Overview</span>
              <span className="card-subtitle">Orders/Pieces Touching Zone — do not sum across zones · row highlighted if the zone has a Warning, Overdue, or Critical order</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ZONE</th>
                  <th>ORDERS</th>
                  <th>PIECES</th>
                  <th>PENDING P/V</th>
                  <th>ACTIVE</th>
                  <th>COMPLETED</th>
                  <th>SLA</th>
                </tr>
              </thead>
              <tbody>
                {data.zoneOverview.map((z) => (
                  <tr key={z.zone} style={ZONE_ROW_STYLE[z.riskLevel]}>
                    <td style={{ fontWeight: 700 }}>{z.zone}</td>
                    <td>{z.orders}</td>
                    <td>{z.totalPieces.toLocaleString()}</td>
                    <td>
                      {z.pickingBacklog} / {z.verificationBacklog}
                    </td>
                    <td>{z.active}</td>
                    <td>{z.completed}</td>
                    <td>{z.slaPct}%</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '18px 0 10px' }}>
              <span className="card-title">Top Overdue Orders</span>
              <span className="card-subtitle">top 20 by elapsed time, longest first</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>PICKER</th>
                  <th>ZONE TOUCHED</th>
                  <th>ELAPSED</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.topOverdueOrders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="link">{o.order_no}</td>
                    <td>{o.pickerName}</td>
                    <td>{o.zones.join(', ') || '—'}</td>
                    <td>{Math.round(o.alert?.elapsed_minutes ?? 0)} min</td>
                    <td>
                      <span className={`badge badge-${o.alert?.time_alert === 'critical' ? 'danger' : 'warning'}`}>{o.alert?.time_alert}</span>
                    </td>
                  </tr>
                ))}
                {data.topOverdueOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      Nothing overdue right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Alerts &amp; Notifications</span>
              <span className="card-subtitle">List of Pending Verification — top 20, longest waiting first</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>PICKER</th>
                  <th>PIECES</th>
                  <th>WAITING</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingVerification.map((o) => (
                  <tr key={o.orderId}>
                    <td className="link">{o.orderNo}</td>
                    <td>{o.pickerName}</td>
                    <td>{o.pieces.toLocaleString()}</td>
                    <td>{o.waitMinutes} min</td>
                  </tr>
                ))}
                {data.pendingVerification.length === 0 && (
                  <tr>
                    <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                      No orders waiting on Admin verification.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <div style={{ marginTop: 'auto', paddingTop: 12, fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
              Backlog = orders whose work isn&apos;t finished yet. Pending P/V (Zone Overview) = Picking backlog + Verification backlog for that zone.
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}
