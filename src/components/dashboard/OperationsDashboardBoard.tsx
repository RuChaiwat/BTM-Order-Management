import Link from 'next/link'
import { KpiCard } from '../KpiCard'

interface BacklogRow {
  orderDate: string
  orders: number
  pieces: number
  daysOld: number
}

interface ZoneStatus {
  zone: string
  orders: number
  totalPieces: number
  pendingPieces: number
  slaPct: number
  onTrack: boolean
}

interface PickerProductivity {
  pickerId: string
  name: string
  pcsPerHour: number
}

interface ActivePickerRow {
  pickerId: string
  name: string
  orders: number
  pieces: number
}

interface DashboardData {
  kpis: {
    totalOrders: number
    totalPieces: number
    assignedOrders: number
    assignedPieces: number
    waitingVerifyOrders: number
    waitingVerifyPieces: number
    completedOrders: number
    completedPieces: number
    issuePieces: number
    pctPiecesCompleted: number
    totalBacklogOrders: number
    totalBacklogPieces: number
    activePickers: number
    activePickerTotalPieces: number
  }
  backlogByDate: BacklogRow[]
  zoneStatus: ZoneStatus[]
  pickerProductivity: PickerProductivity[]
  activePickerRoster: ActivePickerRow[]
  actionRequired: {
    critical: number
    overdue: number
    waitingVerification: number
    correctionInProgress: number
    invalidBinCode: number
  }
}

function backlogAgeColor(daysOld: number): { border: string; text: string } {
  if (daysOld >= 3) return { border: '#DC2626', text: '#DC2626' }
  if (daysOld >= 1) return { border: '#F59E0B', text: '#B45309' }
  return { border: '#9CA3AF', text: '#6B7280' }
}

export function OperationsDashboardBoard({ data }: { data: DashboardData }) {
  const { kpis } = data
  const hasBacklogByDate = data.backlogByDate.length > 0
  const hasActions =
    data.actionRequired.critical > 0 ||
    data.actionRequired.overdue > 0 ||
    data.actionRequired.waitingVerification > 0 ||
    data.actionRequired.correctionInProgress > 0 ||
    data.actionRequired.invalidBinCode > 0

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 16 }}>
      {hasBacklogByDate && (
        <div className="card" style={{ borderLeft: '4px solid #DC2626' }}>
          <div className="card-header" style={{ marginBottom: 10 }}>
            <span className="card-title">Backlog by Order Date</span>
            <span className="card-subtitle">งานค้างแยกตามวันที่ออเดอร์ · ยังไม่ปิดงาน (Admin Verified) · เก่าสุดก่อน</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>ORDER DATE</th>
                <th>DAYS OLD</th>
                <th>ORDERS PENDING</th>
                <th>PIECES PENDING</th>
              </tr>
            </thead>
            <tbody>
              {data.backlogByDate.map((row) => {
                const color = backlogAgeColor(row.daysOld)
                return (
                  <tr key={row.orderDate}>
                    <td style={{ fontWeight: 700 }}>{row.orderDate}</td>
                    <td>
                      <span style={{ color: color.text, fontWeight: 700 }}>{row.daysOld === 0 ? 'Today' : `${row.daysOld}d`}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{row.orders.toLocaleString()}</td>
                    <td>{row.pieces.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        <KpiCard
          label="TOTAL ORDERS"
          labelTh="ออเดอร์ทั้งหมดที่ Import"
          value={`${kpis.totalPieces.toLocaleString()} pcs`}
          sub={`${kpis.totalOrders.toLocaleString()} orders`}
        />
        <KpiCard
          label="ORDERS COMPLETED"
          labelTh="ปิดงานแล้ว (Admin Verified)"
          value={`${kpis.completedPieces.toLocaleString()} pcs`}
          valueColor="#16A34A"
          sub={`${kpis.completedOrders.toLocaleString()} orders`}
          subColor="#16A34A"
        />
        <KpiCard
          label="% COMPLETED"
          labelTh="% ความสำเร็จ (ชิ้น)"
          value={`${kpis.pctPiecesCompleted}%`}
          valueColor={kpis.pctPiecesCompleted >= 85 ? '#16A34A' : kpis.pctPiecesCompleted >= 60 ? '#F59E0B' : '#DC2626'}
          sub={`Completed ${kpis.completedPieces.toLocaleString()} · Issue ${kpis.issuePieces.toLocaleString()}`}
        />
        <KpiCard
          label="TOTAL BACKLOG"
          labelTh="งานคงค้างทั้งหมด"
          value={`${kpis.totalBacklogPieces.toLocaleString()} pcs`}
          valueColor={kpis.totalBacklogPieces > 0 ? '#F59E0B' : undefined}
          sub={`${kpis.totalBacklogOrders.toLocaleString()} orders`}
        />
        <KpiCard
          label="ORDERS ASSIGNED"
          labelTh="มอบหมายงานแล้ว"
          value={`${kpis.assignedPieces.toLocaleString()} pcs`}
          sub={`${kpis.assignedOrders.toLocaleString()} orders`}
        />
        <KpiCard label="ACTIVE PICKERS" labelTh="ผู้หยิบที่ทำงานอยู่" value={kpis.activePickers} sub={`${kpis.activePickerTotalPieces.toLocaleString()} pcs in hand`} />
        <KpiCard
          label="PENDING CONFIRMATION"
          labelTh="รอ Admin Confirm"
          value={`${kpis.waitingVerifyPieces.toLocaleString()} pcs`}
          valueColor={kpis.waitingVerifyPieces > 0 ? '#2563EB' : undefined}
          sub={`${kpis.waitingVerifyOrders.toLocaleString()} orders`}
        />
      </div>

      <div className="card">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Zone Status</span>
          <span className="card-subtitle">สถานะโซน · Pieces Pending drops as Admin confirms · (non-additive) · คลิกเพื่อดูรายละเอียดโซน</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {data.zoneStatus.map((z) => (
            <Link
              key={z.zone}
              href={`/zone-dashboard?zone=${z.zone}`}
              className="card"
              style={{
                textDecoration: 'none',
                color: 'inherit',
                flex: '1 1 150px',
                minWidth: 150,
                maxWidth: 200,
                padding: 12,
                borderTop: `3px solid ${z.onTrack ? '#16A34A' : '#F59E0B'}`,
              }}
            >
              <div style={{ fontSize: 12, fontWeight: 700 }}>Zone {z.zone}</div>
              <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>{z.pendingPieces.toLocaleString()}</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>pieces pending</div>
              <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{z.totalPieces.toLocaleString()} total pieces</div>
              <div style={{ fontSize: 11, marginTop: 6, color: z.onTrack ? '#16A34A' : '#B45309', fontWeight: 500 }}>
                {z.onTrack ? 'On track' : 'At risk'} · {z.slaPct}%
              </div>
            </Link>
          ))}
          {data.zoneStatus.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>No zones found — import Location Master data first.</span>}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
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
          <div className="card-title">Active Pickers — In Progress Now</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            ผู้หยิบที่กำลังดำเนินการอยู่ · orders &amp; pieces still in hand
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>PICKER</th>
                <th>ORDERS</th>
                <th>PIECES</th>
              </tr>
            </thead>
            <tbody>
              {data.activePickerRoster.map((p) => (
                <tr key={p.pickerId}>
                  <td style={{ fontWeight: 700 }}>
                    {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.pickerId})</span>
                  </td>
                  <td>{p.orders}</td>
                  <td>{p.pieces.toLocaleString()}</td>
                </tr>
              ))}
              {data.activePickerRoster.length === 0 && (
                <tr>
                  <td colSpan={3} style={{ color: 'var(--color-text-secondary)' }}>
                    No pickers actively working right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <div className="card-title">Action Required</div>
        <div className="card-subtitle" style={{ marginBottom: 12 }}>
          รายการที่ต้องดำเนินการ
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <ActionRow icon="!" iconBg="#DC2626" title="Critical orders (over 120 min)" count={data.actionRequired.critical} border="#FECACA" bg="#FEF2F2" countColor="#DC2626" />
          <ActionRow icon="⌛" iconBg="#F59E0B" title="Overdue orders (60–120 min)" count={data.actionRequired.overdue} border="#FED7AA" bg="#FFFBEB" countColor="#B45309" />
          <ActionRow icon="✓" iconBg="#2563EB" title="Waiting admin verification" count={data.actionRequired.waitingVerification} border="#E5E7EB" bg="#fff" />
          <ActionRow icon="↺" iconBg="#7C3AED" title="Rejected / correction in progress" count={data.actionRequired.correctionInProgress} border="#E5E7EB" bg="#fff" />
          <ActionRow icon="✕" iconBg="#6B7280" title="Invalid Bin Code in error queue" count={data.actionRequired.invalidBinCode} border="#E5E7EB" bg="#fff" />
          {!hasActions && <span style={{ color: 'var(--color-text-secondary)', gridColumn: '1 / -1' }}>Nothing needs attention right now.</span>}
        </div>
      </div>
    </div>
  )
}

function ActionRow({ icon, iconBg, title, count, border, bg, countColor }: { icon: string; iconBg: string; title: string; count: number; border: string; bg: string; countColor?: string }) {
  if (count === 0) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, border: `1px solid ${border}`, background: bg, borderRadius: 8, padding: '10px 12px' }}>
      <span style={{ width: 22, height: 22, borderRadius: 6, background: iconBg, color: '#fff', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 'none' }}>{icon}</span>
      <div style={{ flex: 1, fontSize: 12.5, fontWeight: 500 }}>{title}</div>
      <span style={{ fontSize: 17, fontWeight: 700, color: countColor }}>{count}</span>
    </div>
  )
}
