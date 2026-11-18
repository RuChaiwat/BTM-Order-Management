import Link from 'next/link'
import type { ReactNode } from 'react'
import { KpiCard } from '../KpiCard'
import { Legend } from '../Legend'
import { BacklogByDateTable } from './BacklogByDateTable'
import { PICK_STAGES, PICK_STAGE_META } from '../../lib/pickBacklog'
import { BACKLOG_META, BACKLOG_STATUSES } from '../../lib/packBacklog'
import type { getDashboardData } from '../../lib/queries/dashboard'
import type { getPackingDashboardData } from '../../lib/queries/packing'

export interface OperationsDashboardProps {
  pick: Awaited<ReturnType<typeof getDashboardData>>
  pack: Awaited<ReturnType<typeof getPackingDashboardData>>
  /** Same figures as Productivity & SLA / Packing Productivity's AVG PCS / HOUR. */
  pickAvg: { rate: number | null; target: number }
  packAvg: { rate: number | null; target: number }
  activeStations: number
  idleStations: number
  /** Minutes each order currently being packed has been open (one per live pack session). */
  packingMinutes: number[]
  packBands: { yellowMinutes: number; redMinutes: number }
  /** Pending Actions Monitor's own counts, so the numbers match that page. */
  pending: { pickingOrders: number; pickingPieces: number; verificationOrders: number; verificationPieces: number }
  access: { backlog: boolean; verification: boolean; packVerify: boolean; packIssues: boolean }
  /** Worst time status among each Action required box's orders (the longest-waiting one) and its wait. */
  actionAlerts: {
    picking: { level: PickLevel; oldest: number }
    verify: { level: PackLevel; oldest: number }
    awaiting: { level: PackLevel; oldest: number }
    issues: { level: PackLevel; oldest: number; pieces: number }
  }
  todayKey: string
  nowMs: number
}

export type PickLevel = 'green' | 'warning' | 'overdue' | 'critical'
export type PackLevel = 'green' | 'yellow' | 'red'

const ORANGE = '#F59E0B'
const C = { green: '#16A34A', amber: '#F59E0B', orange: '#EA580C', red: '#DC2626' }
const PICK_LEVEL_COLOR: Record<PickLevel, string> = { green: C.green, warning: C.amber, overdue: C.orange, critical: C.red }
const PACK_LEVEL_COLOR: Record<PackLevel, string> = { green: C.green, yellow: C.amber, red: C.red }

function pctColor(pct: number | null) {
  if (pct === null) return undefined
  return pct >= 100 ? 'var(--color-success-dark)' : pct >= 80 ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)'
}

function hm(minutes: number) {
  const m = Math.max(0, Math.round(minutes))
  return m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`
}

const waitText = (oldest: number) => (oldest > 0 ? ` · รอนานสุด ${hm(oldest)}` : '')

function Section({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">{title}</span>
        <span className="card-subtitle">{subtitle}</span>
      </div>
      {children}
    </div>
  )
}

/** One time band box: coloured top stripe, time range on top, order count below. */
function BandBox({ color, label, count, highlight }: { color: string; label: string; count: number; highlight: boolean }) {
  return (
    <div className="kpi-card" style={{ padding: 12, borderTop: `3px solid ${color}`, textAlign: 'center' }}>
      <div className="kpi-label-th">{label} (order)</div>
      <div className="kpi-value compact" style={highlight && count > 0 ? { color } : undefined}>
        {count.toLocaleString()}
      </div>
    </div>
  )
}

/** Action required box -- a link to the page where the work gets done (plain box without access). */
function ActionBox({
  href,
  label,
  labelTh,
  value,
  sub,
  color,
  stripe,
  linkText,
}: {
  href: string | null
  label: string
  labelTh: string
  value: number
  sub: string
  color?: string
  stripe: string
  linkText: string
}) {
  const body = (
    <>
      <div className="kpi-label">{label}</div>
      <div className="kpi-label-th">{labelTh}</div>
      <div className="kpi-value compact" style={value > 0 && color ? { color } : undefined}>
        {value.toLocaleString()}
      </div>
      <div className="kpi-sub">{sub}</div>
      {href && <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 12, color: 'var(--color-info)' }}>{linkText} →</div>}
    </>
  )
  const style: React.CSSProperties = { padding: 14, display: 'flex', flexDirection: 'column', textAlign: 'center', textDecoration: 'none', color: 'inherit', borderTop: `3px solid ${stripe}` }
  return href ? (
    <Link href={href} className="kpi-card" style={style}>
      {body}
    </Link>
  ) : (
    <div className="kpi-card" style={style}>
      {body}
    </div>
  )
}

/** Forecast for one side: remaining pieces / pieces actually finished in the last 60 minutes.
 * Shows nothing until today's work has run a full hour. */
function forecast(remaining: number, lastHour: { pieces: number; firstAt: string | null }, nowMs: number) {
  if (remaining <= 0) return { rate: null as number | null, text: 'ไม่มีงานค้าง', color: C.green }
  if (!lastHour.firstAt) return { rate: null, text: 'ยังไม่มีงานเสร็จวันนี้', color: undefined }
  const elapsed = (nowMs - new Date(lastHour.firstAt).getTime()) / 60000
  if (elapsed < 60) return { rate: null, text: `รอข้อมูลครบ 60 นาที (อีก ${Math.ceil(60 - elapsed)} นาที)`, color: undefined }
  if (lastHour.pieces <= 0) return { rate: 0, text: 'ไม่มีงานเสร็จใน 60 นาทีล่าสุด', color: C.red }
  const mins = (remaining / lastHour.pieces) * 60
  const at = new Date(nowMs + mins * 60000).toLocaleTimeString('th-TH', { timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit' })
  return { rate: lastHour.pieces, text: mins >= 1440 ? `~${hm(mins)}` : `~${hm(mins)} · เสร็จประมาณ ${at} น.`, color: undefined }
}

export function OperationsDashboardBoard(p: OperationsDashboardProps) {
  const { pick, pack } = p
  const k = pick.kpis
  const bs = pack.backlogTotal.byStatus
  const pickPct = p.pickAvg.rate !== null && p.pickAvg.target > 0 ? Math.round((p.pickAvg.rate / p.pickAvg.target) * 100) : null
  const packPct = p.packAvg.rate !== null && p.packAvg.target > 0 ? Math.round((p.packAvg.rate / p.packAvg.target) * 100) : null

  // Forecast: work left for pickers / packers themselves (Admin's confirm steps are not counted).
  const pickRemaining = pick.pickBacklogTotal.byStage.waiting.pieces + pick.pickBacklogTotal.byStage.picking.pieces
  const packRemaining = bs.pending.pieces + bs.packing.pieces
  const pickFc = forecast(pickRemaining, pick.pickLastHour, p.nowMs)
  const packFc = forecast(packRemaining, pack.lastHour, p.nowMs)
  const packSlower = pickFc.rate !== null && packFc.rate !== null && pickFc.rate > packFc.rate ? pickFc.rate - packFc.rate : 0

  const t = pick.pickThresholds
  const { yellowMinutes: Y, redMinutes: R } = p.packBands
  const packBand = (m: number) => (m >= R ? 'red' : m >= Y ? 'yellow' : 'green')
  const packCounts = { green: 0, yellow: 0, red: 0 }
  for (const m of p.packingMinutes) packCounts[packBand(m)]++

  const pickStages = PICK_STAGES.map((s) => ({ key: s, ...PICK_STAGE_META[s] }))
  const packStages = BACKLOG_STATUSES.map((s) => ({ key: s, ...BACKLOG_META[s] }))
  const kpi = { compact: true, style: { padding: 14, textAlign: 'center' as const } }
  const grid4: React.CSSProperties = { gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 12 }

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 16 }}>
      {/* 1. Pick overview */}
      <Section title="Pick overview" subtitle="ภาพรวมงานหยิบ">
        <div className="kpi-grid" style={grid4}>
          <KpiCard label="TOTAL ORDERS (PCS)" labelTh="Order ทั้งหมดที่ Import (ชิ้น)" value={k.totalPieces.toLocaleString()} sub={`${k.totalOrders.toLocaleString()} order`} {...kpi} />
          <KpiCard
            label="ORDERS COMPLETED (PCS)"
            labelTh="ปิดงานแล้ว · Admin Verified (ชิ้น)"
            value={k.completedPieces.toLocaleString()}
            valueColor={C.green}
            sub={`${k.completedOrders.toLocaleString()} order`}
            {...kpi}
          />
          <KpiCard
            label="% COMPLETED"
            labelTh="ความสำเร็จ คิดตามชิ้น (%)"
            value={`${k.pctPiecesCompleted}%`}
            valueColor={k.pctPiecesCompleted >= 85 ? C.green : k.pctPiecesCompleted >= 60 ? C.amber : C.red}
            sub={`ปิดงาน ${k.completedPieces.toLocaleString()} · มีปัญหา ${k.issuePieces.toLocaleString()} ชิ้น`}
            {...kpi}
          />
          <KpiCard
            label="TOTAL BACKLOG (PCS)"
            labelTh="งานหยิบคงค้างทั้งหมด (ชิ้น)"
            value={k.totalBacklogPieces.toLocaleString()}
            valueColor={k.totalBacklogPieces > 0 ? ORANGE : undefined}
            sub={`${k.totalBacklogOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14, textAlign: 'center', borderTop: `3px solid ${ORANGE}` }}
          />
          <KpiCard label="ORDERS ASSIGNED (PCS)" labelTh="มอบหมายงานแล้ว (ชิ้น)" value={k.assignedPieces.toLocaleString()} sub={`${k.assignedOrders.toLocaleString()} order`} {...kpi} />
          <KpiCard
            label="ACTIVE PICKERS"
            labelTh="Picker ที่มีงานในมือ (คน)"
            value={k.activePickers.toLocaleString()}
            sub={`ถือ ${k.activePickerTotalOrders.toLocaleString()} order · ${k.activePickerTotalPieces.toLocaleString()} ชิ้น`}
            {...kpi}
          />
          <KpiCard
            label="PENDING CONFIRMATION (PCS)"
            labelTh="รอ Admin Confirm (ชิ้น)"
            value={k.waitingVerifyPieces.toLocaleString()}
            valueColor={k.waitingVerifyPieces > 0 ? '#2563EB' : undefined}
            sub={`${k.waitingVerifyOrders.toLocaleString()} order`}
            {...kpi}
          />
          <KpiCard
            label="AVG PCS / HOUR"
            labelTh="ชิ้นต่อชั่วโมง เฉลี่ยต่อ Picker (ชิ้น/ชม.)"
            value={p.pickAvg.rate?.toLocaleString() ?? '—'}
            valueColor={pctColor(pickPct)}
            sub={`เป้า ${p.pickAvg.target.toLocaleString()} ชิ้น/ชม.${pickPct !== null ? ` · ${pickPct}%` : ''}`}
            {...kpi}
          />
        </div>
      </Section>

      {/* 2. Pack overview */}
      <Section title="Pack overview" subtitle="ภาพรวมงานแพ็ก">
        <div className="kpi-grid" style={grid4}>
          <KpiCard
            label="BACKLOG"
            labelTh="งานแพ็กคงค้าง (ชิ้น)"
            value={pack.backlogTotal.pieces.toLocaleString()}
            valueColor={pack.backlogTotal.pieces > 0 ? ORANGE : undefined}
            sub={`${pack.backlogTotal.orders.toLocaleString()} order`}
            compact
            style={{ padding: 14, textAlign: 'center', borderTop: `3px solid ${ORANGE}` }}
          />
          <KpiCard label="WAITING TO PACK" labelTh="รอแพ็ก (ชิ้น)" value={bs.pending.pieces.toLocaleString()} sub={`${bs.pending.orders.toLocaleString()} order`} {...kpi} />
          <KpiCard label="PACKING NOW" labelTh="กำลังแพ็ก (ชิ้น)" value={bs.packing.pieces.toLocaleString()} sub={`${bs.packing.orders.toLocaleString()} order`} {...kpi} />
          <KpiCard label="AWAITING CONFIRM" labelTh="แพ็กเสร็จ รอยืนยัน (ชิ้น)" value={bs.packed.pieces.toLocaleString()} sub={`${bs.packed.orders.toLocaleString()} order`} {...kpi} />
          <KpiCard
            label="OPEN ISSUES"
            labelTh="ปัญหายังไม่ปิด (issue)"
            value={pack.counts.openIssues.toLocaleString()}
            valueColor={pack.counts.openIssues ? C.red : undefined}
            sub={`${bs.issue.orders.toLocaleString()} order`}
            {...kpi}
          />
          <KpiCard label="PACKED TODAY" labelTh="แพ็กเสร็จวันนี้ (ชิ้น)" value={pack.today.pieces.toLocaleString()} valueColor={C.green} sub={`${pack.today.orders.toLocaleString()} order`} {...kpi} />
          <KpiCard label="ACTIVE STATIONS" labelTh="Station ที่กำลังแพ็ก (Station)" value={p.activeStations.toLocaleString()} sub={`ว่าง ${p.idleStations.toLocaleString()} Station`} {...kpi} />
          <KpiCard
            label="AVG PCS / HOUR"
            labelTh="ชิ้นต่อชั่วโมงแพ็กจริง (ชิ้น/ชม.)"
            value={p.packAvg.rate?.toLocaleString() ?? '—'}
            valueColor={pctColor(packPct)}
            sub={`เป้า ${p.packAvg.target.toLocaleString()} ชิ้น/ชม.${packPct !== null ? ` · ${packPct}%` : ''}`}
            {...kpi}
          />
        </div>
      </Section>

      {/* 3-4. Backlog by order date */}
      <BacklogByDateTable
        title="Pick backlog by order date"
        subtitle="งานหยิบคงค้างแยกตามวันที่ Order · รอนานสุดนับจากเวลา Import"
        rows={pick.pickBacklog}
        total={{ orderDate: '', ...pick.pickBacklogTotal }}
        stages={pickStages}
        todayKey={p.todayKey}
        emptyText="ไม่มีงานหยิบค้าง"
      />
      <BacklogByDateTable
        title="Pack backlog by order date"
        subtitle="งานแพ็กคงค้างแยกตามวันที่ Order · รอนานสุดนับจากเวลาที่ผ่าน Admin Verification"
        rows={pack.backlog.map((r) => ({ ...r, byStage: r.byStatus }))}
        total={{ orderDate: '', ...pack.backlogTotal, byStage: pack.backlogTotal.byStatus }}
        stages={packStages}
        todayKey={p.todayKey}
        emptyText="ไม่มีงานแพ็กค้าง"
      />

      {/* 5. Capacity and forecast */}
      <Section title="Capacity and forecast" subtitle="คาดว่าจะเคลียร์งานคงค้างเสร็จเมื่อไร · อ้างอิงงานที่ทำเสร็จจริงใน 60 นาทีล่าสุด">
        <table className="table" style={{ tableLayout: 'fixed', width: '100%', fontSize: 13 }}>
          <colgroup>
            <col style={{ width: '10%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '34%' }} />
          </colgroup>
          <thead>
            <tr>
              <th />
              <th>งานที่เหลือ (ชิ้น)</th>
              <th>ทำได้ 60 นาทีล่าสุด (ชิ้น/ชม.)</th>
              <th>คน / Station</th>
              <th>คาดว่าเสร็จ</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ fontWeight: 700 }}>Pick</td>
              <td>
                <b>{pickRemaining.toLocaleString()}</b>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>รอหยิบ + กำลังหยิบ</div>
              </td>
              <td style={{ fontWeight: 700 }}>{pickFc.rate?.toLocaleString() ?? '—'}</td>
              <td>{k.activePickers.toLocaleString()} คน</td>
              <td style={{ fontWeight: 700, color: pickFc.color }}>{pickFc.text}</td>
            </tr>
            <tr>
              <td style={{ fontWeight: 700 }}>Pack</td>
              <td>
                <b>{packRemaining.toLocaleString()}</b>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>รอแพ็ก + กำลังแพ็ก</div>
              </td>
              <td style={{ fontWeight: 700 }}>{packFc.rate?.toLocaleString() ?? '—'}</td>
              <td>{p.activeStations.toLocaleString()} Station</td>
              <td style={{ fontWeight: 700, color: packFc.color }}>{packFc.text}</td>
            </tr>
          </tbody>
        </table>
        {packSlower > 0 && (
          <div style={{ marginTop: 10, padding: '8px 12px', borderRadius: 8, background: 'var(--color-warning-bg)', color: 'var(--color-warning-dark)', fontSize: 12.5, fontWeight: 600 }}>
            ⚠ Pack ทำได้ช้ากว่า Pick {packSlower.toLocaleString()} ชิ้น/ชม. · งานรอแพ็กจะเพิ่มขึ้น
          </div>
        )}
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          ไม่นับงานรอ Admin ยืนยัน · ตัวเลขจะแสดงเมื่อเริ่มงานวันนี้ครบ 60 นาที
        </div>
      </Section>

      {/* 6. Picking and packing (in progress, by time) */}
      <Section title="Picking and packing" subtitle="งานที่กำลังทำอยู่ แยกตามเวลา">
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              Picking <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-text-secondary)' }}>นับจากเวลาที่ Assign</span>
            </div>
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <BandBox color={C.amber} label={`${t.warning}–${t.overdue - 1} นาที`} count={pick.pickInProgress.warning} highlight />
              <BandBox color={C.orange} label={`${t.overdue}–${t.critical - 1} นาที`} count={pick.pickInProgress.overdue} highlight />
              <BandBox color={C.red} label={`≥ ${t.critical} นาที`} count={pick.pickInProgress.critical} highlight />
            </div>
            <Legend
              style={{ marginTop: 10 }}
              items={[
                { color: C.amber, label: 'ใกล้เกินกำหนด' },
                { color: C.orange, label: 'เกินกำหนด' },
                { color: C.red, label: 'วิกฤต' },
              ]}
            />
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 8 }}>
              Packing <span style={{ fontWeight: 400, fontSize: 12, color: 'var(--color-text-secondary)' }}>นับจากเวลาที่เริ่มแพ็ก</span>
            </div>
            <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10 }}>
              <BandBox color={C.green} label={`< ${Y} นาที`} count={packCounts.green} highlight={false} />
              <BandBox color={C.amber} label={`${Y}–${R - 1} นาที`} count={packCounts.yellow} highlight />
              <BandBox color={C.red} label={`≥ ${R} นาที`} count={packCounts.red} highlight />
            </div>
            <Legend
              style={{ marginTop: 10 }}
              items={[
                { color: C.green, label: 'ปกติ' },
                { color: C.amber, label: 'เริ่มนาน' },
                { color: C.red, label: 'นานเกินไป' },
              ]}
            />
          </div>
        </div>
      </Section>

      {/* 7. Action required */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
        <div className="card">
          <div className="card-header" style={{ marginBottom: 10 }}>
            <span className="card-title">Action required · Pick</span>
            {p.access.backlog && (
              <Link href="/backlog" className="card-link" style={{ fontSize: 12 }}>
                Pending Actions Monitor →
              </Link>
            )}
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <ActionBox
              href={p.access.backlog ? '/backlog?filter=picking' : null}
              label="PICKING PENDING (PCS)"
              labelTh="รอ Picker ดำเนินการ (ชิ้น)"
              value={p.pending.pickingPieces}
              sub={`${p.pending.pickingOrders.toLocaleString()} order${waitText(p.actionAlerts.picking.oldest)}`}
              color={C.amber}
              stripe={PICK_LEVEL_COLOR[p.actionAlerts.picking.level]}
              linkText="Pending Actions Monitor"
            />
            <ActionBox
              href={p.access.verification ? '/verification' : null}
              label="VERIFICATION PENDING (PCS)"
              labelTh="รอ Admin ตรวจสอบ (ชิ้น)"
              value={p.pending.verificationPieces}
              sub={`${p.pending.verificationOrders.toLocaleString()} order${waitText(p.actionAlerts.verify.oldest)}`}
              color="#2563EB"
              stripe={PACK_LEVEL_COLOR[p.actionAlerts.verify.level]}
              linkText="Admin Verification"
            />
          </div>
          <Legend
            style={{ marginTop: 10 }}
            note="Picking pending ·"
            items={[
              { color: C.green, label: 'ปกติ' },
              { color: C.amber, label: 'ใกล้เกินกำหนด' },
              { color: C.orange, label: 'เกินกำหนด' },
              { color: C.red, label: 'วิกฤต' },
            ]}
          />
          <Legend
            style={{ marginTop: 4 }}
            note="Verification pending ·"
            items={[
              { color: C.green, label: `ปกติ (< ${Y} นาที)` },
              { color: C.amber, label: `เริ่มนาน (${Y}–${R - 1} นาที)` },
              { color: C.red, label: `นานเกินไป (≥ ${R} นาที)` },
            ]}
          />
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--color-text-secondary)' }}>สีของกล่องตาม order ที่รอนานที่สุดในกล่อง</div>
        </div>
        <div className="card">
          <div className="card-header" style={{ marginBottom: 10 }}>
            <span className="card-title">Action required · Pack</span>
          </div>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 10 }}>
            <ActionBox
              href={p.access.packVerify ? '/pack-verification' : null}
              label="AWAITING CONFIRM (PCS)"
              labelTh="แพ็กเสร็จ รอยืนยัน (ชิ้น)"
              value={bs.packed.pieces}
              sub={`${bs.packed.orders.toLocaleString()} order${waitText(p.actionAlerts.awaiting.oldest)}`}
              color="#8B5CF6"
              stripe={PACK_LEVEL_COLOR[p.actionAlerts.awaiting.level]}
              linkText="Admin Pack Verify"
            />
            <ActionBox
              href={p.access.packIssues ? '/pack-issues' : null}
              label="OPEN ISSUES (PCS)"
              labelTh="ปัญหายังไม่ปิด (ชิ้น)"
              value={p.actionAlerts.issues.pieces}
              sub={`${bs.issue.orders.toLocaleString()} order · ${pack.counts.openIssues.toLocaleString()} issue${waitText(p.actionAlerts.issues.oldest)}`}
              color={C.red}
              stripe={PACK_LEVEL_COLOR[p.actionAlerts.issues.level]}
              linkText="ตรวจสอบปัญหา"
            />
          </div>
          <Legend
            style={{ marginTop: 10 }}
            note="สีของกล่องตามรายการที่รอนานที่สุดในกล่อง ·"
            items={[
              { color: C.green, label: `ปกติ (< ${Y} นาที)` },
              { color: C.amber, label: `เริ่มนาน (${Y}–${R - 1} นาที)` },
              { color: C.red, label: `นานเกินไป (≥ ${R} นาที)` },
            ]}
          />
        </div>
      </div>
    </div>
  )
}
