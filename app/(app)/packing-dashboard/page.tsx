import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { BarList, HourBars } from '@/components/packing/BarList'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { canAccessMenuItem } from '@/lib/roles'
import { getLiveMonitorData, getPackIssueList, getPackingDashboardData } from '@/lib/queries/packing'
import { getPackVerifyQueue } from '@/lib/queries/packVerification'
import { RISK_COLOR } from '@/lib/alertColors'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

export const dynamic = 'force-dynamic'

function hm(minutes: number) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที` : `${minutes} นาที`
}

const minsSince = (iso: string | null) => (iso ? Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000)) : 0)

/** Stations packing right now, by how long their current order has been open (client thresholds). */
const TIME_BUCKETS = [
  { key: 'green', label: 'PACKING < 30 MIN', th: 'ใช้เวลาแพ็กน้อยกว่า 30 นาที (Station)', test: (m: number) => m < 30 },
  { key: 'yellow', label: 'PACKING 30–60 MIN', th: 'ใช้เวลาแพ็ก 30–60 นาที (Station)', test: (m: number) => m >= 30 && m < 60 },
  { key: 'red', label: 'PACKING ≥ 60 MIN', th: 'ใช้เวลาแพ็ก 60 นาทีขึ้นไป (Station)', test: (m: number) => m >= 60 },
] as const

export default async function PackingDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 21)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const [d, refreshMs, monitor, issueList, verifyQueue] = await Promise.all([
    getPackingDashboardData(admin, warehouseCode),
    getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.packingDashboard),
    getLiveMonitorData(admin, warehouseCode),
    // resolvedSince = now -> open/investigating issues only
    getPackIssueList(admin, warehouseCode, new Date().toISOString()),
    getPackVerifyQueue(admin, warehouseCode),
  ])

  // One open session per station is the norm; if a station somehow has two, its longest one counts.
  const stationMinutes = new Map<string, number>()
  for (const s of monitor.live) stationMinutes.set(s.station_code, Math.max(stationMinutes.get(s.station_code) ?? 0, minsSince(s.started_at)))
  const activeStations = stationMinutes.size
  const buckets = TIME_BUCKETS.map((b) => {
    const codes = [...stationMinutes].filter(([, m]) => b.test(m)).map(([code]) => code)
    return { ...b, codes }
  })
  const topIssues = issueList
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => a.reported_at.localeCompare(b.reported_at))
    .slice(0, 10)
  const openIssueCount = issueList.filter((i) => i.status !== 'resolved').length
  const topAwaiting = verifyQueue.slice(0, 10)
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
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Link href="/packing-dashboard/queue" title="ดูรายการ order ที่รอแพ็ก" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
            <KpiCard
              label="WAITING TO PACK"
              labelTh="รอแพ็ก (order)"
              value={d.counts.pending.toLocaleString()}
              sub={
                <>
                  {d.counts.pending ? `เก่าสุด ${hm(d.oldestMinutes)} · ` : 'ไม่มีงานค้าง · '}
                  <span className="card-link" style={{ fontSize: 12 }}>
                    ดูรายการ →
                  </span>
                </>
              }
              compact
              style={{ padding: 14, height: '100%', cursor: 'pointer' }}
            />
          </Link>
          <KpiCard label="PACKING NOW" labelTh="กำลังแพ็ก (order)" value={d.counts.packing.toLocaleString()} sub={link(22, '/pack-monitor', 'Live monitor')} compact style={{ padding: 14 }} />
          <KpiCard label="AWAITING CONFIRM" labelTh="แพ็กเสร็จ รอยืนยัน (order)" value={d.counts.packed.toLocaleString()} sub={link(23, '/pack-verification', 'Admin Pack Verify')} compact style={{ padding: 14 }} />
          <KpiCard
            label="OPEN ISSUES"
            labelTh="ปัญหายังไม่ปิด (issue)"
            value={d.counts.openIssues.toLocaleString()}
            valueColor={d.counts.openIssues ? '#DC2626' : undefined}
            sub={link(24, '/pack-issues', 'ตรวจสอบปัญหา') ?? `${d.counts.issue.toLocaleString()} order`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard label="PACKED TODAY" labelTh="แพ็กเสร็จวันนี้ (ชิ้น)" value={d.today.pieces.toLocaleString()} valueColor="#16A34A" sub={`${d.today.orders.toLocaleString()} order · ${d.today.packers} คน · ยืนยันแล้ว ${d.today.confirmed.toLocaleString()} order`} compact style={{ padding: 14 }} />
        </div>

        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard
            label="ACTIVE STATIONS"
            labelTh="Station ที่กำลังแพ็ก (Station)"
            value={activeStations.toLocaleString()}
            sub={
              <>
                Idle <b>{monitor.idleStations.length.toLocaleString()}</b> Station · {link(22, '/pack-monitor', 'Live monitor')}
              </>
            }
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
            <div className="card-title">Pack backlog aging</div>
            <div className="card-subtitle" style={{ marginBottom: 14 }}>
              อายุของ order ที่รอแพ็ก นับจากเวลาที่ผ่าน Admin Verification
            </div>
            <BarList rows={d.aging.map((a) => ({ label: a.label, value: a.count }))} color="var(--color-warning)" />
          </div>
          <div className="card">
            <div className="card-title">Pieces packed per hour (today)</div>
            <div className="card-subtitle">จำนวนชิ้นที่แพ็กเสร็จรายชั่วโมง (ไม่นับชิ้นที่แจ้งปัญหา)</div>
            <HourBars rows={d.hourly.map((h) => ({ hour: h.hour, value: h.pieces }))} color="var(--color-success)" />
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 14, alignItems: 'start' }}>
          <div className="card">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <span className="card-title">Top 10 open issues</span>
              {link(24, '/pack-issues', `ดูทั้งหมด (${openIssueCount.toLocaleString()} issue)`)}
            </div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>
              ปัญหาที่ยังไม่ปิด · เรียงจากเปิดค้างนานที่สุด
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
                    <td style={{ fontWeight: 700, color: minsSince(i.reported_at) >= 60 ? RISK_COLOR.red : minsSince(i.reported_at) >= 30 ? RISK_COLOR.yellow : undefined }}>{hm(minsSince(i.reported_at))}</td>
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
                      ไม่มีปัญหาค้าง · No open issues
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="card">
            <div className="card-header" style={{ marginBottom: 8 }}>
              <span className="card-title">Top 10 awaiting confirm</span>
              {link(23, '/pack-verification', `ดูทั้งหมด (${verifyQueue.length.toLocaleString()} order)`)}
            </div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>
              แพ็กเสร็จแล้ว รอ Admin Pack Verify · เรียงจากรอนานที่สุด
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
                    <td style={{ fontWeight: 700, color: o.waitMinutes >= 60 ? RISK_COLOR.red : o.waitMinutes >= 30 ? RISK_COLOR.yellow : undefined }}>{hm(o.waitMinutes)}</td>
                    <td>
                      <span className={`badge ${o.isShort ? 'badge-warning' : o.hadIssue ? 'badge-danger' : 'badge-success'}`} style={{ fontSize: 10 }}>
                        {o.isShort ? 'Short' : o.hadIssue ? 'เคยมีปัญหา' : 'ครบ'}
                      </span>
                    </td>
                  </tr>
                ))}
                {topAwaiting.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                      ไม่มี order รอยืนยัน · Nothing awaiting confirm
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
