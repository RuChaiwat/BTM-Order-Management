import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { PackDateFilter } from '@/components/packing/PackDateFilter'
import { HourBars } from '@/components/packing/BarList'
import { PackerProductivityTable, StationProductivityTable } from '@/components/packing/PackProductivityTables'
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
          <KpiCard label="PIECES PACKED" labelTh="ชิ้นที่แพ็กเสร็จ ไม่นับชิ้นมีปัญหา (ชิ้น)" value={d.totals.pieces.toLocaleString()} valueColor="#16A34A" sub={`${d.totals.orders.toLocaleString()} order`} compact style={{ padding: 14 }} />
          <KpiCard label="AVG PCS / HOUR" labelTh="ชิ้นต่อชั่วโมง เฉลี่ยทั้งทีม (ชิ้น/ชม.)" value={d.totals.pcsPerHour?.toLocaleString() ?? '—'} valueColor={pctColor(totalPct)} sub={`เป้า ${target.toLocaleString()} ชิ้น/ชม.${totalPct !== null ? ` · ${totalPct}%` : ''}`} compact style={{ padding: 14 }} />
          <KpiCard label="PACKERS" labelTh="พนักงานแพ็ก (คน)" value={d.totals.packers.toLocaleString()} sub={`เวลาแพ็กรวม ${dur(d.totals.seconds)}`} compact style={{ padding: 14 }} />
          <KpiCard label="ISSUES REPORTED" labelTh="แจ้งปัญหา (order)" value={d.totals.issues.toLocaleString()} valueColor={d.totals.issues ? '#DC2626' : undefined} sub={`หัก ${d.totals.issuePieces.toLocaleString()} ชิ้นจากปัญหา`} compact style={{ padding: 14 }} />
          <KpiCard label="AVG TIME / ORDER" labelTh="เวลาเฉลี่ยต่อ order (นาที)" value={d.totals.orders ? (d.totals.seconds / d.totals.orders / 60).toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'} sub={d.totals.orders ? dur(Math.round(d.totals.seconds / d.totals.orders)) : undefined} compact style={{ padding: 14 }} />
        </div>

        <div className="card">
          <div className="card-title">Packer productivity</div>
          <div className="card-subtitle" style={{ marginBottom: 10 }}>
            รายคน · ชิ้น/ชม. = ชิ้นที่นับได้ ÷ เวลาแพ็กจริง (scan เริ่ม → ปิดงาน) รวมทุก Station ที่ทำ · เทียบเป้า {target.toLocaleString()} ชิ้น/ชม. · กดหัวคอลัมน์เพื่อเรียงลำดับ
          </div>
          <PackerProductivityTable packers={d.packers} target={target} />
        </div>

        <div className="card">
          <div className="card-title">Pieces packed per hour</div>
          <div className="card-subtitle" style={{ marginBottom: 10 }}>
            จำนวนชิ้นที่แพ็กเสร็จรายชั่วโมง (นับตามเวลาที่ปิดงาน) · ทั้งวัน
          </div>
          <HourBars rows={d.hourly.map((h) => ({ hour: h.hour, value: h.pieces, orders: h.orders }))} color="var(--color-success)" />
        </div>

        <div className="card">
          <div className="card-title">By station</div>
          <div className="card-subtitle" style={{ marginBottom: 10 }}>
            ราย Station · กดหัวคอลัมน์เพื่อเรียงลำดับ
          </div>
          <StationProductivityTable stations={d.stations} />
        </div>
      </div>
    </>
  )
}
