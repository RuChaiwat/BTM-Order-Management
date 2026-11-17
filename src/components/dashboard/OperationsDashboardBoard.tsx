import Link from 'next/link'
import { KpiCard } from '../KpiCard'
import { formatDate } from '../../lib/formatDate'
import { PickerProductivityTable } from './PickerProductivityTable'
import { ActivePickerRosterTable } from './ActivePickerRosterTable'
import { RISK_COLOR } from '../../lib/alertColors'
import { PRODUCTIVITY_LEVEL_META } from '../../lib/pickerProductivity'
import { Legend } from '../Legend'

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
  riskLevel: 'red' | 'yellow' | 'green'
  criticalCount: number
  overdueCount: number
}

interface PickerProductivity {
  pickerId: string
  name: string
  employmentType: string | null
  pcsPerHour: number
  level: string
}

interface ActivePickerRow {
  pickerId: string
  name: string
  employmentType: string | null
  orders: number
  pieces: number
  elapsedMinutes: number
  timeAlert: 'warning' | 'overdue' | 'critical' | null
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
    activePickerTotalOrders: number
  }
  backlogByDate: BacklogRow[]
  zoneStatus: ZoneStatus[]
  pickerProductivity: PickerProductivity[]
  targetPcsPerHour: number
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
            <span className="card-subtitle">งานค้างแยกตามวันที่ Order</span>
          </div>
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '25%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  ORDER
                  <br />
                  DATE
                </th>
                <th>
                  DAYS
                  <br />
                  OLD
                </th>
                <th>
                  ORDERS
                  <br />
                  PENDING
                </th>
                <th>
                  PIECES
                  <br />
                  PENDING
                </th>
              </tr>
            </thead>
            <tbody>
              {data.backlogByDate.map((row) => {
                const color = backlogAgeColor(row.daysOld)
                return (
                  <tr key={row.orderDate}>
                    <td style={{ fontWeight: 700 }}>{formatDate(row.orderDate)}</td>
                    <td>
                      <span style={{ color: color.text, fontWeight: 700 }}>{row.daysOld === 0 ? 'วันนี้' : `${row.daysOld} วัน`}</span>
                    </td>
                    <td style={{ fontWeight: 700 }}>{row.orders.toLocaleString()}</td>
                    <td>{row.pieces.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>นับเฉพาะ Order ที่ยังไม่ปิดงาน (Admin ยังไม่ยืนยัน)</div>
        </div>
      )}

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)' }}>
        <KpiCard
          label="TOTAL ORDERS (PCS)"
          labelTh="Order ทั้งหมดที่ Import (ชิ้น)"
          value={kpis.totalPieces.toLocaleString()}
          sub={`${kpis.totalOrders.toLocaleString()} order`}
          style={{ textAlign: 'center' }}
        />
        <KpiCard
          label="ORDERS COMPLETED (PCS)"
          labelTh="ปิดงานแล้ว · Admin Verified (ชิ้น)"
          value={kpis.completedPieces.toLocaleString()}
          valueColor="#16A34A"
          sub={`${kpis.completedOrders.toLocaleString()} order`}
          subColor="#16A34A"
          style={{ textAlign: 'center' }}
        />
        <KpiCard
          label="% COMPLETED"
          labelTh="ความสำเร็จ คิดตามชิ้น (%)"
          value={`${kpis.pctPiecesCompleted}%`}
          valueColor={kpis.pctPiecesCompleted >= 85 ? '#16A34A' : kpis.pctPiecesCompleted >= 60 ? '#F59E0B' : '#DC2626'}
          sub={`ปิดงาน ${kpis.completedPieces.toLocaleString()} · มีปัญหา ${kpis.issuePieces.toLocaleString()}`}
          style={{ textAlign: 'center' }}
        />
        <KpiCard
          label="TOTAL BACKLOG (PCS)"
          labelTh="งานคงค้างทั้งหมด (ชิ้น)"
          value={kpis.totalBacklogPieces.toLocaleString()}
          valueColor={kpis.totalBacklogPieces > 0 ? '#F59E0B' : undefined}
          sub={`${kpis.totalBacklogOrders.toLocaleString()} order`}
          style={{ textAlign: 'center' }}
        />
        <KpiCard
          label="ORDERS ASSIGNED (PCS)"
          labelTh="มอบหมายงานแล้ว (ชิ้น)"
          value={kpis.assignedPieces.toLocaleString()}
          sub={`${kpis.assignedOrders.toLocaleString()} order`}
          style={{ textAlign: 'center' }}
        />
        <KpiCard
          label="ACTIVE PICKERS (PCS)"
          labelTh="งานในมือ Picker ที่ทำงานอยู่ (ชิ้น)"
          value={kpis.activePickerTotalPieces.toLocaleString()}
          sub={`${kpis.activePickerTotalOrders.toLocaleString()} order ในมือ`}
          style={{ textAlign: 'center' }}
        />
        <KpiCard
          label="PENDING CONFIRMATION (PCS)"
          labelTh="รอ Admin Confirm (ชิ้น)"
          value={kpis.waitingVerifyPieces.toLocaleString()}
          valueColor={kpis.waitingVerifyPieces > 0 ? '#2563EB' : undefined}
          sub={`${kpis.waitingVerifyOrders.toLocaleString()} order`}
          style={{ textAlign: 'center' }}
        />
      </div>

      <div className="card">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Zone Status</span>
          <span className="card-subtitle">สถานะโซน</span>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
          {data.zoneStatus.map((z) => {
            const riskColor = RISK_COLOR[z.riskLevel]
            // Share of this zone's pieces whose order the picker has already submitted -- the same
            // basis as "pieces pending" on this card (total - pending), not the admin-verified basis
            // of the % COMPLETED KPI above. Coloured by the zone's lateness risk so a red/yellow zone
            // still stands out now that the "On track / N overdue" label is gone (it moved to the tooltip).
            const pctDone = z.totalPieces > 0 ? Math.round(((z.totalPieces - z.pendingPieces) / z.totalPieces) * 1000) / 10 : 0
            const riskLabel =
              z.riskLevel === 'red' ? `วิกฤต ${z.criticalCount} order` : z.riskLevel === 'yellow' ? `เกินกำหนด ${z.overdueCount} order` : 'ตามกำหนด'
            return (
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
                  borderTop: `3px solid ${riskColor}`,
                  textAlign: 'center',
                }}
                title={riskLabel}
              >
                <div style={{ fontSize: 14, fontWeight: 700 }}>Zone {z.zone}</div>
                <div style={{ fontSize: 22, fontWeight: 700, lineHeight: 1.3 }}>{z.pendingPieces.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>ชิ้นค้าง</div>
                <div style={{ fontSize: 20, fontWeight: 700, lineHeight: 1.3, marginTop: 4 }}>{z.totalPieces.toLocaleString()}</div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>ชิ้นทั้งหมด</div>
                <div style={{ marginTop: 8, display: 'flex', justifyContent: 'center' }}>
                  <span className={`badge ${z.riskLevel === 'red' ? 'badge-danger' : z.riskLevel === 'yellow' ? 'badge-warning' : 'badge-success'}`} style={{ fontWeight: 700 }}>
                    เสร็จ {pctDone}%
                  </span>
                </div>
              </Link>
            )
          })}
          {data.zoneStatus.length === 0 && <span style={{ color: 'var(--color-text-secondary)' }}>ไม่พบโซน — กรุณา Import ข้อมูล Location Master ก่อน</span>}
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>ชิ้นค้างจะลดลงเมื่อ Picker ส่งงาน · คลิกการ์ดเพื่อดูรายละเอียดโซน</div>
          <Legend
            items={[
              { color: RISK_COLOR.green, label: 'ตามกำหนด' },
              { color: RISK_COLOR.yellow, label: 'มี Order เกินกำหนด' },
              { color: RISK_COLOR.red, label: 'มี Order วิกฤต' },
            ]}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-title">Today&apos;s Picker Productivity</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            ประสิทธิผลผู้หยิบสินค้า (ชิ้น/ชม.)
          </div>
          <PickerProductivityTable pickers={data.pickerProductivity} targetPcsPerHour={data.targetPcsPerHour} />
          <div style={{ marginTop: 12, paddingTop: 12, borderTop: '1px dashed var(--color-border)', fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
            <Legend
              note={`เป้าหมาย ${data.targetPcsPerHour.toLocaleString()} ชิ้น/ชม.`}
              items={[
                { color: PRODUCTIVITY_LEVEL_META.above_target.color, label: 'เกินเป้า' },
                { color: PRODUCTIVITY_LEVEL_META.target.color, label: '80–100%' },
                { color: PRODUCTIVITY_LEVEL_META.yellow.color, label: '60–80%' },
                { color: PRODUCTIVITY_LEVEL_META.red.color, label: 'ต่ำกว่า 60%' },
              ]}
            />
            <div style={{ marginTop: 4 }}>ปรับเป้าได้ที่หน้า Configuration</div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Active Pickers — In Progress Now</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            ผู้หยิบที่กำลังดำเนินการอยู่
          </div>
          <ActivePickerRosterTable pickers={data.activePickerRoster} />
        </div>
      </div>

      <div className="card">
        <div className="card-title">Action Required</div>
        <div className="card-subtitle" style={{ marginBottom: 12 }}>
          รายการที่ต้องดำเนินการ
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
          <ActionRow icon="!" iconBg="#DC2626" title="Order วิกฤต" count={data.actionRequired.critical} border="#FECACA" bg="#FEF2F2" countColor="#DC2626" />
          <ActionRow icon="⌛" iconBg="#F59E0B" title="Order เกินกำหนด" count={data.actionRequired.overdue} border="#FED7AA" bg="#FFFBEB" countColor="#B45309" />
          <ActionRow icon="✓" iconBg="#2563EB" title="รอ Admin ยืนยัน" count={data.actionRequired.waitingVerification} border="#E5E7EB" bg="#fff" />
          <ActionRow icon="↺" iconBg="#7C3AED" title="ถูกตีกลับ / กำลังแก้ไข" count={data.actionRequired.correctionInProgress} border="#E5E7EB" bg="#fff" />
          <ActionRow icon="✕" iconBg="#6B7280" title="Bin Code ไม่ถูกต้อง (รอแก้ไข)" count={data.actionRequired.invalidBinCode} border="#E5E7EB" bg="#fff" />
          {!hasActions && <span style={{ color: 'var(--color-text-secondary)', gridColumn: '1 / -1' }}>ไม่มีรายการที่ต้องดำเนินการในขณะนี้</span>}
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
