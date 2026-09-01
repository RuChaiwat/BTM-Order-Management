import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardData } from '@/lib/queries/dashboard'
import { redirect } from 'next/navigation'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

const STATUS_LABELS: Record<string, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  picker_completed_100: 'Picker Completed 100%',
  picker_completed_short: 'Picker Completed Short',
  waiting_admin_verification: 'Waiting Admin Verification',
  admin_rejected: 'Admin Rejected',
  correction_in_progress: 'Correction in Progress',
  final_closed_100: 'Final Closed 100%',
  final_closed_short: 'Final Closed Short',
  cancelled: 'Cancelled',
}

export default async function OperationsDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const data = await getDashboardData(admin, user.warehouse_code ?? 'DC002')

  const totalBacklog = data.kpis.pickingBacklog + data.kpis.verificationBacklog
  const pctOfPlan = data.kpis.totalPlannedPieces > 0 ? Math.round((data.kpis.piecesPicked / data.kpis.totalPlannedPieces) * 1000) / 10 : 0

  return (
    <AppLayout activeNavId={1}>
      <TopBar title="Operations Dashboard" subtitle={`ภาพรวมการดำเนินงาน · ${user.warehouse_code ?? ''}`}>
        <div className="control">
          <span style={{ fontWeight: 500 }}>{user.warehouse_code ?? '—'}</span>
        </div>
      </TopBar>

      <div className="page-body">
        <div className="flow-strip">
          <span className="flow-strip-label">FLOW</span>
          <span className="flow-step" style={{ background: '#EFF6FF', color: '#1D4ED8' }}>
            Import Orders <span className="flow-step-count">{data.flow.importOrders}</span>
          </span>
          <span className="flow-arrow">→</span>
          <span className="flow-step" style={{ background: '#F3F4F6', color: '#374151' }}>
            Assignment <span className="flow-step-count">{data.flow.assignment}</span>
          </span>
          <span className="flow-strip-meta">Pre-screen/Matching/Batch Split/Pick Report stages come from the Order Consolidation module (not yet built)</span>
        </div>

        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
          <KpiCard label="TOTAL ORDERS" labelTh="ออเดอร์ทั้งหมด" value={data.kpis.totalOrders.toLocaleString()} />
          <KpiCard label="TOTAL PIECES (PLAN)" labelTh="จำนวนชิ้นตามแผน" value={data.kpis.totalPlannedPieces.toLocaleString()} />
          <KpiCard
            label="PIECES PICKED"
            labelTh="หยิบแล้ว (จริง)"
            value={data.kpis.piecesPicked.toLocaleString()}
            valueColor="#16A34A"
            sub={`${pctOfPlan}% of plan`}
            subColor="#16A34A"
          />
          <KpiCard label="PICKER COMPLETED" labelTh="ผู้หยิบปิดงานแล้ว" value={data.kpis.pickerCompletedCount} sub={`100% ${data.kpis.pickerCompleted100} · Short ${data.kpis.pickerCompletedShort}`} />
          <KpiCard
            label="TOTAL BACKLOG"
            labelTh="งานคงค้าง"
            value={totalBacklog}
            valueColor={totalBacklog > 0 ? '#F59E0B' : undefined}
            sub={`Picking ${data.kpis.pickingBacklog} · Verify ${data.kpis.verificationBacklog}`}
          />
          <KpiCard label="ACTIVE PICKERS" labelTh="ผู้หยิบที่ทำงานอยู่" value={data.kpis.activePickers} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1.25fr 1fr 1fr', gap: 16, flex: 1, minHeight: 0 }}>
          <div className="card">
            <div className="card-header">
              <span className="card-title">Zone Status</span>
              <span className="card-subtitle">สถานะโซน · Orders Touching Zone (non-additive)</span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 10 }}>
              {data.zoneStatus.map((z) => (
                <div key={z.zone} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 12, borderTop: `3px solid ${z.onTrack ? '#16A34A' : '#F59E0B'}` }}>
                  <div style={{ fontSize: 12, fontWeight: 700 }}>{z.zone}</div>
                  <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>{z.orders}</div>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>orders touching</div>
                  <div style={{ fontSize: 11, marginTop: 6, color: z.onTrack ? '#16A34A' : '#B45309', fontWeight: 500 }}>
                    {z.onTrack ? 'On track' : 'At risk'} · {z.slaPct}%
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, margin: '20px 0 12px' }}>
              <span className="card-title">Order Status Breakdown</span>
              <span className="card-subtitle">Total {data.kpis.totalOrders} orders from Order Core</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12 }}>
              {Object.entries(data.statusCounts).map(([status, count]) => (
                <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ flex: 1 }}>{STATUS_LABELS[status] ?? status}</span>
                  <span style={{ fontWeight: 700 }}>{count}</span>
                </div>
              ))}
              {Object.keys(data.statusCounts).length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>No orders yet — import some from Order Pool.</span>}
            </div>
          </div>

          <div className="card">
            <div className="card-title">Today&apos;s Picker Productivity</div>
            <div className="card-subtitle" style={{ marginBottom: 12 }}>
              ผลิตภาพผู้หยิบสินค้า · pieces per hour
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11, fontSize: 12.5 }}>
              {data.pickerProductivity.map((p) => (
                <div key={p.pickerId} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ width: 100 }}>{p.name}</span>
                  <span
                    style={{
                      height: 10,
                      borderRadius: 5,
                      background: p.pcsPerHour >= 4500 ? '#16A34A' : p.pcsPerHour >= 3150 ? '#F59E0B' : '#DC2626',
                      width: Math.max(8, Math.min(100, (p.pcsPerHour / 4500) * 100)),
                    }}
                  />
                  <span style={{ fontWeight: 700, marginLeft: 'auto' }}>{p.pcsPerHour.toLocaleString()}</span>
                </div>
              ))}
              {data.pickerProductivity.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>No completed picks yet today.</span>}
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--color-border)', fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
              Target 4,500 pcs/hr · green ≥ target, yellow within 30%, red below
            </div>
          </div>

          <div className="card">
            <div className="card-title">Action Required</div>
            <div className="card-subtitle" style={{ marginBottom: 12 }}>
              รายการที่ต้องดำเนินการ
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <ActionRow icon="!" iconBg="#DC2626" title="Critical orders" count={data.actionRequired.critical} border="#FECACA" bg="#FEF2F2" countColor="#DC2626" />
              <ActionRow icon="⌛" iconBg="#F59E0B" title="Overdue orders" count={data.actionRequired.overdue} border="#FED7AA" bg="#FFFBEB" countColor="#B45309" />
              <ActionRow icon="✓" iconBg="#2563EB" title="Waiting admin verification" count={data.actionRequired.waitingVerification} border="#E5E7EB" bg="#fff" />
              <ActionRow icon="✕" iconBg="#6B7280" title="Invalid Bin Code in error queue" count={data.actionRequired.invalidBinCode} border="#E5E7EB" bg="#fff" />
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  )
}

function ActionRow({ icon, iconBg, title, count, border, bg, countColor }: { icon: string; iconBg: string; title: string; count: number; border: string; bg: string; countColor?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${border}`, background: bg, borderRadius: 8, padding: '10px 12px' }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: iconBg, color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icon}</span>
      <div style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{title}</div>
      <span style={{ fontSize: 17, fontWeight: 700, color: countColor }}>{count}</span>
    </div>
  )
}
