import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { PackDateFilter } from '@/components/packing/PackDateFilter'
import { HourBars } from '@/components/packing/BarList'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getPackingProductivity } from '@/lib/queries/packing'
import { getPackingSettings } from '@/lib/packing'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'

export const dynamic = 'force-dynamic'

function dur(sec: number | null) {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(sec % 60).padStart(2, '0')}s`
}

export default async function PackingProductivityPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 25)
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const date = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.date ?? '') ? searchParams.date! : bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
  const admin = createAdminClient()
  const [d, settings] = await Promise.all([getPackingProductivity(admin, warehouseCode, date), getPackingSettings(admin)])
  const target = settings.targetPcsPerHour
  const pctOfTarget = (rate: number | null) => (rate !== null && target > 0 ? Math.round((rate / target) * 100) : null)
  const pctColor = (pct: number | null) => (pct === null ? undefined : pct >= 100 ? 'var(--color-success-dark)' : pct >= 80 ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)')
  const totalPct = pctOfTarget(d.totals.pcsPerHour)

  return (
    <>
      <TopBar title="Packing Productivity" subtitle={`ประสิทธิผลงานแพ็กรายวัน · ${formatDate(date)} · ${warehouseCode}`}>
        <PackDateFilter basePath="/packing-productivity" date={date} />
        <ExportExcelButton href={`/api/packing-productivity/export?date=${date}`} />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <KpiCard label="PIECES PACKED" labelTh="ชิ้นที่แพ็กเสร็จ (ไม่นับชิ้นมีปัญหา)" value={d.totals.pieces.toLocaleString()} valueColor="#16A34A" sub={`${d.totals.orders.toLocaleString()} orders`} compact style={{ padding: 14 }} />
          <KpiCard label="AVG PCS / HOUR" labelTh="ชิ้นต่อชั่วโมง (เฉลี่ยทั้งทีม)" value={d.totals.pcsPerHour?.toLocaleString() ?? '—'} valueColor={pctColor(totalPct)} sub={`target ${target.toLocaleString()} pcs/hr${totalPct !== null ? ` · ${totalPct}%` : ''}`} compact style={{ padding: 14 }} />
          <KpiCard label="PACKERS" labelTh="จำนวนพนักงานแพ็ก" value={d.totals.packers.toLocaleString()} sub={`เวลาแพ็กรวม ${dur(d.totals.seconds)}`} compact style={{ padding: 14 }} />
          <KpiCard label="ISSUES REPORTED" labelTh="order ที่แจ้งปัญหา" value={d.totals.issues.toLocaleString()} valueColor={d.totals.issues ? '#DC2626' : undefined} sub={`${d.totals.issuePieces.toLocaleString()} ชิ้นมีปัญหา`} compact style={{ padding: 14 }} />
          <KpiCard label="AVG TIME / ORDER" labelTh="เวลาเฉลี่ยต่อ order" value={d.totals.orders ? dur(Math.round(d.totals.seconds / d.totals.orders)) : '—'} compact style={{ padding: 14 }} />
        </div>

        <div className="card">
          <div className="card-title">Packer productivity</div>
          <div className="card-subtitle" style={{ marginBottom: 10 }}>
            รายคน · ชิ้น/ชม. = ชิ้นที่นับได้ ÷ เวลาแพ็กจริง (scan เริ่ม → ปิดงาน) · เทียบเป้า {target.toLocaleString()} ชิ้น/ชม.
          </div>
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '26%' }} />
              <col style={{ width: '8%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '9%' }} />
              <col style={{ width: '10%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>PACKER</th>
                <th>ORDERS</th>
                <th>PIECES</th>
                <th>
                  PACK
                  <br />
                  TIME
                </th>
                <th>
                  PCS
                  <br />
                  / HOUR
                </th>
                <th>
                  % OF
                  <br />
                  TARGET
                </th>
                <th>
                  AVG
                  <br />
                  / ORDER
                </th>
                <th>ISSUES</th>
                <th>STATIONS</th>
              </tr>
            </thead>
            <tbody>
              {d.packers.map((p) => {
                const pct = pctOfTarget(p.pcsPerHour)
                return (
                  <tr key={p.picker_id}>
                    <td style={{ overflowWrap: 'break-word' }}>
                      {p.name}
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{p.picker_id}</div>
                    </td>
                    <td>{p.orders.toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>{p.pieces.toLocaleString()}</td>
                    <td>{dur(p.seconds)}</td>
                    <td style={{ fontWeight: 700 }}>{p.pcsPerHour?.toLocaleString() ?? '—'}</td>
                    <td style={{ fontWeight: 700, color: pctColor(pct) }}>{pct !== null ? `${pct}%` : '—'}</td>
                    <td>{dur(p.avgSecondsPerOrder)}</td>
                    <td style={{ color: p.issuesReported ? 'var(--color-danger)' : undefined }}>
                      {p.issuesReported}
                      {p.issuePieces > 0 && <div style={{ fontSize: 11 }}>{p.issuePieces} ชิ้น</div>}
                    </td>
                    <td style={{ fontSize: 12, overflowWrap: 'break-word' }}>{p.stations.join(', ')}</td>
                  </tr>
                )
              })}
              {d.packers.length === 0 && (
                <tr>
                  <td colSpan={9} style={{ color: 'var(--color-text-secondary)' }}>
                    ไม่มีงานแพ็กที่ปิดในวันนี้ · No packing finished on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.4fr)', gap: 14, alignItems: 'start' }}>
          <div className="card">
            <div className="card-title">By station</div>
            <div className="card-subtitle" style={{ marginBottom: 10 }}>
              ราย Station
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '18%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '20%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>STATION</th>
                  <th>ORDERS</th>
                  <th>PIECES</th>
                  <th>
                    PCS
                    <br />
                    / HOUR
                  </th>
                  <th>ISSUES</th>
                </tr>
              </thead>
              <tbody>
                {d.stations.map((s) => (
                  <tr key={s.station_code}>
                    <td style={{ fontWeight: 700 }}>{s.station_code}</td>
                    <td>{s.orders.toLocaleString()}</td>
                    <td>{s.pieces.toLocaleString()}</td>
                    <td style={{ fontWeight: 700 }}>{s.pcsPerHour?.toLocaleString() ?? '—'}</td>
                    <td>{s.issuesReported}</td>
                  </tr>
                ))}
                {d.stations.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      —
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="card">
            <div className="card-title">Pieces packed per hour</div>
            <div className="card-subtitle">จำนวนชิ้นที่แพ็กเสร็จรายชั่วโมง</div>
            <HourBars rows={d.hourly.map((h) => ({ hour: h.hour, value: h.pieces }))} color="var(--color-success)" />
          </div>
        </div>
      </div>
    </>
  )
}
