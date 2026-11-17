import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getControlTowerData } from '@/lib/queries/controlTower'
import { ALERT_COLOR, ALERT_LABEL_COLOR, ALERT_BADGE_TONE } from '@/lib/alertColors'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'
import { Legend } from '@/components/Legend'

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

const ALERT_TH: Record<'warning' | 'overdue' | 'critical', string> = { warning: 'ใกล้เกินกำหนด', overdue: 'เกินกำหนด', critical: 'วิกฤต' }

export default async function ControlTowerPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 10)
  const admin = createAdminClient()
  const [data, refreshMs] = await Promise.all([
    getControlTowerData(admin, user.warehouse_code ?? 'DC002'),
    getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.controlTower),
  ])

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Control Tower" subtitle={`ศูนย์ควบคุม · ${user.warehouse_code ?? ''}`} />

      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
          <KpiCard
            label="TOTAL ORDERS (PCS)"
            labelTh="Order ทั้งหมดที่ Import (ชิ้น)"
            value={data.kpis.totalPlannedPieces.toLocaleString()}
            sub={`${data.kpis.totalOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="ORDERS COMPLETED (PCS)"
            labelTh="ปิดงานแล้ว · Admin Verified (ชิ้น)"
            value={data.kpis.completedPieces.toLocaleString()}
            valueColor="#16A34A"
            sub={`${data.kpis.completedOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="% COMPLETED"
            labelTh="ความสำเร็จ คิดตามชิ้น (%)"
            value={`${data.kpis.pctPiecesCompleted}%`}
            valueColor={data.kpis.pctPiecesCompleted >= 85 ? '#16A34A' : data.kpis.pctPiecesCompleted >= 60 ? '#F59E0B' : '#DC2626'}
            sub={`ปิดงาน ${data.kpis.completedPieces.toLocaleString()} · มีปัญหา ${data.kpis.issuePieces.toLocaleString()}`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="TOTAL BACKLOG (PCS)"
            labelTh="งานคงค้างทั้งหมด (ชิ้น)"
            value={data.kpis.totalBacklogPieces.toLocaleString()}
            valueColor={data.kpis.totalBacklogPieces > 0 ? '#F59E0B' : undefined}
            sub={`${data.kpis.totalBacklogOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="ORDERS ASSIGNED (PCS)"
            labelTh="มอบหมายงานแล้ว (ชิ้น)"
            value={data.kpis.assignedPieces.toLocaleString()}
            sub={`${data.kpis.assignedOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="ACTIVE PICKERS (PCS)"
            labelTh="งานในมือ Picker ที่ทำงานอยู่ (ชิ้น)"
            value={data.kpis.activePickerTotalPieces.toLocaleString()}
            sub={`${data.kpis.activePickerTotalOrders.toLocaleString()} order ในมือ`}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
        </div>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard
            label="WARNING ORDERS (PCS)"
            labelTh="Order ใกล้เกินกำหนด · Warning (ชิ้น)"
            value={data.secondaryKpis.warningPieces.toLocaleString()}
            sub={`${data.secondaryKpis.warningOrders.toLocaleString()} order`}
            accentColor="#F59E0B"
            labelColor="#B45309"
            valueColor="#B45309"
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="OVERDUE ORDERS (PCS)"
            labelTh="Order เกินกำหนด · Overdue (ชิ้น)"
            value={data.secondaryKpis.overduePieces.toLocaleString()}
            sub={`${data.secondaryKpis.overdueOrders.toLocaleString()} order`}
            accentColor={ALERT_COLOR.overdue}
            labelColor={ALERT_LABEL_COLOR.overdue}
            valueColor={ALERT_LABEL_COLOR.overdue}
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="CRITICAL ORDERS (PCS)"
            labelTh="Order วิกฤต · Critical (ชิ้น)"
            value={data.secondaryKpis.criticalPieces.toLocaleString()}
            sub={`${data.secondaryKpis.criticalOrders.toLocaleString()} order`}
            accentColor="#DC2626"
            valueColor="#DC2626"
            compact
            style={{ padding: 14, textAlign: 'center' }}
          />
          <KpiCard
            label="PENDING CONFIRMATION (PCS)"
            labelTh="รอ Admin Confirm (ชิ้น)"
            value={data.kpis.waitingVerifyPieces.toLocaleString()}
            valueColor={data.worstVerificationAlert ? ALERT_COLOR[data.worstVerificationAlert] : data.kpis.waitingVerifyPieces > 0 ? '#2563EB' : undefined}
            accentColor={data.worstVerificationAlert ? ALERT_COLOR[data.worstVerificationAlert] : undefined}
            sub={`${data.kpis.waitingVerifyOrders.toLocaleString()} order · ${data.worstVerificationAlert ? ALERT_TH[data.worstVerificationAlert] ?? data.worstVerificationAlert : 'ตามกำหนด'}`}
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
              <span className="card-subtitle">ภาพรวมโซน</span>
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '11%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '15%' }} />
                <col style={{ width: '17%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '19%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>ZONE</th>
                  <th>ORDERS</th>
                  <th>PIECES</th>
                  <th>
                    PENDING
                    <br />
                    P/V
                  </th>
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
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>นับ Order/ชิ้นที่ผ่านแต่ละโซน — ห้ามรวมข้ามโซน</div>
            <Legend
              style={{ marginTop: 6 }}
              note="สีแถว:"
              items={[
                { color: ZONE_ROW_STYLE.warning.background ?? '', label: 'มี Order ใกล้เกินกำหนด' },
                { color: ZONE_ROW_STYLE.overdue.background ?? '', label: 'มี Order เกินกำหนด' },
                { color: ZONE_ROW_STYLE.critical.background ?? '', label: 'มี Order วิกฤต' },
              ]}
            />

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '18px 0 10px' }}>
              <span className="card-title">Top Overdue Picks</span>
              <span className="card-subtitle">Order ที่หยิบล่าช้าที่สุด · 20 อันดับ</span>
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '16%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '20%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>PICKER</th>
                  <th>
                    ZONE
                    <br />
                    TOUCHED
                  </th>
                  <th>ELAPSED</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.topOverdueOrders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="link">{o.order_no}</td>
                    <td style={{ overflowWrap: 'break-word' }}>
                      {o.pickerName}
                      {o.pickerEmploymentType && <div style={{ fontSize: 11, color: '#6B7280' }}>{o.pickerEmploymentType}</div>}
                    </td>
                    <td style={{ overflowWrap: 'break-word' }}>{o.zones.join(', ') || '—'}</td>
                    <td>{Math.round(o.alert?.elapsed_minutes ?? 0)} นาที</td>
                    <td>
                      <span className={`badge badge-${o.alert?.time_alert === 'critical' ? 'danger' : 'warning'}`}>{o.alert?.time_alert ? ALERT_TH[o.alert.time_alert as 'warning' | 'overdue' | 'critical'] ?? o.alert.time_alert : ''}</span>
                    </td>
                  </tr>
                ))}
                {data.topOverdueOrders.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      ไม่มี Order ที่เกินกำหนดในขณะนี้
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header">
              <span className="card-title">Top Pending Confirmations</span>
              <span className="card-subtitle">รายการรอ Admin ยืนยัน · 20 อันดับ</span>
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '18%' }} />
                <col style={{ width: '28%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '24%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>PICKER</th>
                  <th>PIECES</th>
                  <th>WAITING</th>
                  <th>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.pendingVerification.map((o) => (
                  <tr key={o.orderId}>
                    <td className="link">{o.orderNo}</td>
                    <td style={{ overflowWrap: 'break-word' }}>
                      {o.pickerName}
                      {o.pickerEmploymentType && <div style={{ fontSize: 11, color: '#6B7280' }}>{o.pickerEmploymentType}</div>}
                    </td>
                    <td>{o.pieces.toLocaleString()}</td>
                    <td>{o.waitMinutes} นาที</td>
                    <td>
                      {o.timeAlert ? (
                        <span className={`badge badge-${ALERT_BADGE_TONE[o.timeAlert]}`}>{ALERT_TH[o.timeAlert] ?? o.timeAlert}</span>
                      ) : (
                        <span className="badge badge-success">ตามกำหนด</span>
                      )}
                    </td>
                  </tr>
                ))}
                {data.pendingVerification.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      ไม่มี Order ที่รอ Admin ยืนยัน
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </>
  )
}
