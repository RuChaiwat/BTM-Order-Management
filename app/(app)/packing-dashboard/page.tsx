import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { Legend } from '@/components/Legend'
import { HourBars } from '@/components/packing/BarList'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { canAccessMenuItem } from '@/lib/roles'
import { getLiveMonitorData, getPackIssueList, getPackingDashboardData, getPackingProductivity } from '@/lib/queries/packing'
import { BACKLOG_META, BACKLOG_STATUSES, type BacklogStatus } from '@/lib/packBacklog'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'
import { getPackVerifyQueue } from '@/lib/queries/packVerification'
import { RISK_COLOR } from '@/lib/alertColors'
import { getPackingSettings, packTimeBand } from '@/lib/packing'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

export const dynamic = 'force-dynamic'

function hm(minutes: number) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที` : `${minutes} นาที`
}

/** Wait time with days for the multi-day backlog: "2 วัน 6 ชม.", "20 ชม.", "45 นาที". */
function ageText(minutes: number) {
  if (minutes >= 1440) {
    const h = Math.floor((minutes % 1440) / 60)
    return `${Math.floor(minutes / 1440)} วัน${h ? ` ${h} ชม.` : ''}`
  }
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ชม.` : `${minutes} นาที`
}

type StatusCounts = Record<BacklogStatus, { orders: number; pieces: number }>

const minsSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0)

export default async function PackingDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 21)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const todayKey = bangkokDateKey(new Date()) ?? ''
  const [d, refreshMs, monitor, issueList, verifyQueue, bands, productivity] = await Promise.all([
    getPackingDashboardData(admin, warehouseCode),
    getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.packingDashboard),
    getLiveMonitorData(admin, warehouseCode),
    // resolvedSince = now -> open/investigating issues only
    getPackIssueList(admin, warehouseCode, new Date().toISOString()),
    getPackVerifyQueue(admin, warehouseCode),
    getPackingSettings(admin),
    // Same figure as Packing Productivity's AVG PCS / HOUR (pieces / actual pack time, all stations).
    getPackingProductivity(admin, warehouseCode, todayKey),
  ])
  const { yellowMinutes: Y, redMinutes: R } = bands
  // Stations packing right now, by how long their current order has been open (Configuration > Packing).
  const TIME_BUCKETS = [
    { key: 'green', label: `PACKING < ${Y} MIN`, th: `ใช้เวลาแพ็กน้อยกว่า ${Y} นาที (Station)` },
    { key: 'yellow', label: `PACKING ${Y}–${R - 1} MIN`, th: `ใช้เวลาแพ็ก ${Y}–${R - 1} นาที (Station)` },
    { key: 'red', label: `PACKING ≥ ${R} MIN`, th: `ใช้เวลาแพ็ก ${R} นาทีขึ้นไป (Station)` },
  ] as const
  const timeColor = (m: number) => {
    const b = packTimeBand(m, bands)
    return b === 'green' ? undefined : RISK_COLOR[b]
  }
  const timeLegend = (
    <Legend
      style={{ marginTop: 10 }}
      items={[
        { color: RISK_COLOR.yellow, label: `${Y}–${R - 1} นาที` },
        { color: RISK_COLOR.red, label: `${R} นาทีขึ้นไป` },
      ]}
    />
  )

  // One open session per station is the norm; if a station somehow has two, its longest one counts.
  const stationMinutes = new Map<string, number>()
  for (const s of monitor.live) stationMinutes.set(s.station_code, Math.max(stationMinutes.get(s.station_code) ?? 0, minsSince(s.timer_from)))
  const activeStations = stationMinutes.size
  const buckets = TIME_BUCKETS.map((b) => {
    const codes = [...stationMinutes].filter(([, m]) => packTimeBand(m, bands) === b.key).map(([code]) => code)
    return { ...b, codes }
  })
  const topIssues = issueList
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => a.reported_at.localeCompare(b.reported_at))
    .slice(0, 10)
  const openIssueCount = issueList.filter((i) => i.status !== 'resolved').length
  const topAwaiting = verifyQueue.slice(0, 10)
  const daysOld = (dateKey: string) => Math.round((Date.parse(todayKey) - Date.parse(dateKey)) / 86400000)
  const backlogTotal = d.backlogTotal
  const bs = backlogTotal.byStatus
  const target = bands.targetPcsPerHour
  const avgRate = productivity.totals.pcsPerHour
  const avgPct = avgRate !== null && target > 0 ? Math.round((avgRate / target) * 100) : null
  const avgColor = avgPct === null ? undefined : avgPct >= 100 ? 'var(--color-success-dark)' : avgPct >= 80 ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)'
  // One segment per status, width by orders; hover shows that status's orders and pieces.
  const statusBar = (row: { orders: number; byStatus: StatusCounts }) => {
    const segs = BACKLOG_STATUSES.filter((st) => row.byStatus[st].orders > 0)
    return (
      <div style={{ display: 'flex', height: 12 }}>
        {segs.map((st, i) => {
          const first = i === 0 ? 3 : 0
          const last = i === segs.length - 1 ? 3 : 0
          return (
            <div
              key={st}
              className="seg-tip"
              data-tip={`${BACKLOG_META[st].label}\n${row.byStatus[st].orders.toLocaleString()} order · ${row.byStatus[st].pieces.toLocaleString()} ชิ้น`}
              style={{ width: `${(row.byStatus[st].orders / row.orders) * 100}%`, background: BACKLOG_META[st].color, borderRadius: `${first}px ${last}px ${last}px ${first}px` }}
            />
          )
        })}
      </div>
    )
  }
  const link = (id: number, href: string, text: string) =>
    canAccessMenuItem(user.role, id) ? (
      <Link href={href} className="card-link" style={{ fontSize: 12 }}>
        {text} →
      </Link>
    ) : null

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Packing Dashboard" subtitle={`แดชบอร์ดงานแพ็ก · วันนี้ · ${warehouseCode}`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12 }}>
          <KpiCard
            label="BACKLOG"
            labelTh="งานแพ็กคงค้าง (ชิ้น)"
            value={backlogTotal.pieces.toLocaleString()}
            valueColor={backlogTotal.pieces > 0 ? '#F59E0B' : undefined}
            sub={`${backlogTotal.orders.toLocaleString()} order`}
            footer={
              <Link href="/packing-dashboard/queue?status=all" className="card-link">
                ดูรายการ →
              </Link>
            }
            compact
            style={{ padding: 14, borderTop: '3px solid #F59E0B' }}
          />
          <KpiCard
            label="WAITING TO PACK"
            labelTh="รอแพ็ก (ชิ้น)"
            value={bs.pending.pieces.toLocaleString()}
            sub={`${bs.pending.orders.toLocaleString()} order`}
            footer={
              <Link href="/packing-dashboard/queue?status=pending" className="card-link">
                ดูรายการ →
              </Link>
            }
            compact
            style={{ padding: 14 }}
          />
          <KpiCard label="PACKING NOW" labelTh="กำลังแพ็ก (ชิ้น)" value={bs.packing.pieces.toLocaleString()} sub={`${bs.packing.orders.toLocaleString()} order`} footer={link(22, '/pack-monitor', 'Live monitor')} compact style={{ padding: 14 }} />
          <KpiCard label="AWAITING CONFIRM" labelTh="แพ็กเสร็จ รอยืนยัน (ชิ้น)" value={bs.packed.pieces.toLocaleString()} sub={`${bs.packed.orders.toLocaleString()} order`} footer={link(23, '/pack-verification', 'Admin Pack Verify')} compact style={{ padding: 14 }} />
          <KpiCard
            label="OPEN ISSUES"
            labelTh="ปัญหายังไม่ปิด (issue)"
            value={d.counts.openIssues.toLocaleString()}
            valueColor={d.counts.openIssues ? '#DC2626' : undefined}
            sub={`${bs.issue.orders.toLocaleString()} order · ปิดวันนี้ ${d.issueFix.resolved.toLocaleString()} issue · ใช้เวลาแก้เฉลี่ย ${d.issueFix.avgMinutes === null ? '—' : hm(d.issueFix.avgMinutes)}`}
            footer={link(24, '/pack-issues', 'ตรวจสอบปัญหา')}
            compact
            style={{ padding: 14 }}
          />
        </div>

        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gap: 12 }}>
          <KpiCard label="PACKED TODAY" labelTh="แพ็กเสร็จวันนี้ (ชิ้น)" value={d.today.pieces.toLocaleString()} valueColor="#16A34A" sub={`${d.today.orders.toLocaleString()} order`} compact style={{ padding: 14 }} />
          <KpiCard
            label="AVG PCS / HOUR"
            labelTh="ชิ้นต่อชั่วโมง เฉลี่ย (ชิ้น/ชม.)"
            value={avgRate?.toLocaleString() ?? '—'}
            valueColor={avgColor}
            sub={`เป้า ${target.toLocaleString()} ชิ้น/ชม.${avgPct !== null ? ` · ${avgPct}%` : ''}`}
            footer={link(25, '/packing-productivity', 'Packing Productivity')}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="ACTIVE STATIONS"
            labelTh="Station ที่กำลังแพ็ก (Station)"
            value={activeStations.toLocaleString()}
            sub={
              <>
                ว่าง <b>{monitor.idleStations.length.toLocaleString()}</b> Station
              </>
            }
            footer={link(22, '/pack-monitor', 'Live monitor')}
            compact
            style={{ padding: 14 }}
          />
          {buckets.map((b) => (
            <div key={b.key} className="kpi-card" style={{ padding: 14, borderTop: `3px solid ${RISK_COLOR[b.key]}` }}>
              <div className="kpi-label" style={{ color: RISK_COLOR[b.key] }}>
                {b.label}
              </div>
              <div className="kpi-label-th">{b.th}</div>
              <div className="kpi-value compact" style={b.codes.length && b.key !== 'green' ? { color: RISK_COLOR[b.key] } : undefined}>
                {b.codes.length.toLocaleString()}
              </div>
              <div className="kpi-sub" style={{ overflowWrap: 'break-word' }}>
                {b.codes.length ? b.codes.sort().join(', ') : '—'}
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: 14, alignItems: 'start' }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: 2 }}>
              <span className="card-title">Pack backlog by order date</span>
              <Link href="/packing-dashboard/queue?status=all" className="card-link" style={{ fontSize: 12 }}>
                ดูรายการ →
              </Link>
            </div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>
              งานแพ็กคงค้างแยกตามวันที่ Order · {d.backlog.length.toLocaleString()} วัน · {backlogTotal.orders.toLocaleString()} order
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%', fontSize: 12.5 }}>
              <colgroup>
                <col style={{ width: '28%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '26%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>ORDER DATE</th>
                  <th>ORDER</th>
                  <th>ชิ้น</th>
                  <th>งานที่เหลือ</th>
                  <th>รอนานสุด</th>
                </tr>
              </thead>
              <tbody>
                {d.backlog.map((r) => {
                  const days = daysOld(r.orderDate)
                  return (
                    <tr key={r.orderDate}>
                      <td style={{ fontWeight: 700 }}>
                        {formatDate(r.orderDate)}{' '}
                        {days >= 2 ? (
                          <span className="badge badge-danger" style={{ fontSize: 10 }}>
                            {days} วัน
                          </span>
                        ) : days === 0 ? (
                          <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>วันนี้</span>
                        ) : null}
                      </td>
                      <td>{r.orders.toLocaleString()}</td>
                      <td>{r.pieces.toLocaleString()}</td>
                      <td>{statusBar(r)}</td>
                      <td style={{ fontWeight: 700, color: r.oldestMinutes >= 480 ? '#DC2626' : undefined }}>{ageText(r.oldestMinutes)}</td>
                    </tr>
                  )
                })}
                {d.backlog.length === 0 ? (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      ไม่มีงานแพ็กค้าง
                    </td>
                  </tr>
                ) : (
                  <tr>
                    <td style={{ fontWeight: 700 }}>รวม</td>
                    <td style={{ fontWeight: 700 }}>{backlogTotal.orders.toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>{backlogTotal.pieces.toLocaleString()}</td>
                    <td>{statusBar(backlogTotal)}</td>
                    <td />
                  </tr>
                )}
              </tbody>
            </table>
            <Legend style={{ marginTop: 10 }} items={BACKLOG_STATUSES.map((st) => ({ color: BACKLOG_META[st].color, label: BACKLOG_META[st].label }))} note="ชี้ที่แถบสีเพื่อดูจำนวน order และชิ้น ·" />
          </div>
          <div className="card">
            <div className="card-title">Pieces packed per hour (today)</div>
            <div className="card-subtitle">จำนวนชิ้นที่แพ็กเสร็จรายชั่วโมง</div>
            <HourBars rows={d.hourly.map((h) => ({ hour: h.hour, value: h.pieces, orders: h.orders }))} color="var(--color-success)" />
            <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>ไม่นับชิ้นที่แจ้งปัญหา</div>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <span className="card-title">Top 10 open issues</span>
              {link(24, '/pack-issues', `ดูทั้งหมด (${openIssueCount.toLocaleString()} issue)`)}
            </div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>
              ปัญหาที่ยังไม่ปิด
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%', fontSize: 12.5 }}>
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '13%' }} />
                <col style={{ width: '27%' }} />
                <col style={{ width: '10%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>ORDER</th>
                  <th>STATION</th>
                  <th>ปัญหา</th>
                  <th>ชิ้น</th>
                  <th>เปิดมาแล้ว</th>
                  <th>สถานะ</th>
                </tr>
              </thead>
              <tbody>
                {topIssues.map((i) => (
                  <tr key={i.issue_id}>
                    <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>
                      {i.order_no}
                      <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>{i.packerName}</div>
                    </td>
                    <td>{i.station_code ?? '—'}</td>
                    <td style={{ overflowWrap: 'break-word' }}>{i.reasons.join(', ') || '—'}</td>
                    <td>{i.pieces.toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: timeColor(minsSince(i.reported_at)) }}>{hm(minsSince(i.reported_at))}</td>
                    <td>
                      <span className={`badge ${i.status === 'open' ? 'badge-danger' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                        {i.status === 'open' ? 'ยังไม่รับเรื่อง' : 'กำลังตรวจสอบ'}
                      </span>
                    </td>
                  </tr>
                ))}
                {topIssues.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                      ไม่มีปัญหาค้าง
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {timeLegend}
          </div>

          <div className="card">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <span className="card-title">Top 10 awaiting confirm</span>
              {link(23, '/pack-verification', `ดูทั้งหมด (${verifyQueue.length.toLocaleString()} order)`)}
            </div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>
              รอ Admin Pack Verify
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%', fontSize: 12.5 }}>
              <colgroup>
                <col style={{ width: '26%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '14%' }} />
                <col style={{ width: '12%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>ORDER</th>
                  <th>STORE</th>
                  <th>PACKER</th>
                  <th>ชิ้น</th>
                  <th>รอมาแล้ว</th>
                  <th>ผล</th>
                </tr>
              </thead>
              <tbody>
                {topAwaiting.map((o) => (
                  <tr key={o.order_id}>
                    <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>
                      {o.order_no}
                      {o.stationCode && <div style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>{o.stationCode}</div>}
                    </td>
                    <td style={{ overflowWrap: 'break-word' }}>{o.store_code}</td>
                    <td style={{ overflowWrap: 'break-word' }}>{o.packerName}</td>
                    <td>{o.pieces.toLocaleString()}</td>
                    <td style={{ fontWeight: 700, color: timeColor(o.waitMinutes) }}>{hm(o.waitMinutes)}</td>
                    <td>
                      <span className={`badge ${o.isShort ? 'badge-warning' : o.hadIssue ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: 10 }}>
                        {o.isShort ? 'ไม่ครบ' : o.hadIssue ? 'เคยมีปัญหา' : 'ครบ'}
                      </span>
                    </td>
                  </tr>
                ))}
                {topAwaiting.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                      ไม่มี order รอยืนยัน
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            {timeLegend}
          </div>
        </div>
      </div>
    </>
  )
}
