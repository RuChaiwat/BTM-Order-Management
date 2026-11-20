import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { PackDateFilter } from '@/components/packing/PackDateFilter'
import { BarList } from '@/components/packing/BarList'
import { ShortPickMonitorBoard } from '@/components/shortPickMonitor/ShortPickMonitorBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickingIssueDashboard } from '@/lib/queries/shortPickMonitor'
import { formatLocationDisplay } from '@/lib/locations/locationDisplay'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'
import { requireMenuAccess } from '@/lib/pageAccess'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** Picking Issue Dashboard -- laid out like Packing Issue Dashboard: date range (last 30 days by
 * default), KPI boxes, bar charts by reason / zone / picker / SKU / location, then the item list. */
export default async function PickingIssueDashboardPage({ searchParams }: { searchParams: { from?: string; to?: string; date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 19)
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const today = bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
  const defaultFrom = bangkokDateKey(new Date(Date.now() - 29 * 86400000)) ?? today
  // Old links with ?date= open that one day.
  const single = DATE_RE.test(searchParams.date ?? '') ? searchParams.date! : null
  let from = DATE_RE.test(searchParams.from ?? '') ? searchParams.from! : single ?? defaultFrom
  let to = DATE_RE.test(searchParams.to ?? '') ? searchParams.to! : single ?? today
  if (from > to) [from, to] = [to, from]
  const d = await getPickingIssueDashboard(createAdminClient(), warehouseCode, from, to)
  const bars = (list: { key: string; count: number; pieces: number }[], label?: (k: string) => string) =>
    list.map((r) => ({ label: label ? label(r.key) : r.key, value: r.count, sub: `· ${r.pieces.toLocaleString()} ชิ้น` }))

  const card = (title: string, th: string, children: React.ReactNode) => (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        {th}
      </div>
      {children}
    </div>
  )

  return (
    <>
      <AutoRefresh />
      <TopBar title="Picking Issue Dashboard" subtitle={`แดชบอร์ดปัญหาการหยิบ · ${formatDate(from)} – ${formatDate(to)} · ${warehouseCode}`}>
        <PackDateFilter basePath="/short-pick-monitor" from={from} to={to} />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard
            label="SHORT ORDERS"
            labelTh="order ที่หยิบไม่ครบ (order)"
            value={d.kpis.shortOrders.toLocaleString()}
            valueColor={d.kpis.shortOrders ? '#DC2626' : undefined}
            sub={`จาก ${d.kpis.pickedOrders.toLocaleString()} order ที่หยิบ`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="SHORT PIECES"
            labelTh="ชิ้นที่หยิบไม่ครบ (ชิ้น)"
            value={d.kpis.shortPieces.toLocaleString()}
            valueColor={d.kpis.shortPieces ? '#DC2626' : undefined}
            sub={`จาก ${d.kpis.pickedPieces.toLocaleString()} ชิ้นที่หยิบ`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="SHORT ORDERS RATE"
            labelTh="สัดส่วน order ที่หยิบไม่ครบ (%)"
            value={d.kpis.shortOrderRatePct !== null ? `${d.kpis.shortOrderRatePct}%` : '—'}
            sub="short order ÷ order ที่หยิบ"
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="SHORT PIECES RATE"
            labelTh="สัดส่วนชิ้นที่หยิบไม่ครบ (%)"
            value={d.kpis.shortPieceRatePct !== null ? `${d.kpis.shortPieceRatePct}%` : '—'}
            sub="ชิ้นที่ขาด ÷ ชิ้นที่สั่งของ order ที่หยิบ"
            compact
            style={{ padding: 14 }}
          />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, alignItems: 'start' }}>
          {card('By reason', 'แยกตามเหตุผล (รายการ · ชิ้น)', <BarList rows={bars(d.byReason)} color="var(--color-danger)" />)}
          {card('By zone', 'แยกตาม Zone (รายการ · ชิ้น)', <BarList rows={bars(d.byZone)} color="var(--color-info)" />)}
          {card('By picker', 'แยกตาม Picker · Top 15 (order · ชิ้น)', <BarList rows={bars(d.byPicker)} color="var(--color-warning)" />)}
          {card('By SKU', 'สินค้าที่หยิบไม่ครบบ่อย · Top 15 (รายการ · ชิ้น)', <BarList rows={bars(d.bySku)} color="var(--color-warning)" />)}
          {card('By location', 'Location ที่หยิบไม่ครบบ่อย · Top 15 (รายการ · ชิ้น)', <BarList rows={bars(d.byLocation, (k) => formatLocationDisplay(k))} color="var(--color-success)" />)}
        </div>

        <ShortPickMonitorBoard rows={d.rows} zones={d.zones} from={from} to={to} warehouseCode={warehouseCode} />
        <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>นับตามวันที่ Picker ปิดงาน · รายการ Short จะแสดงหลัง Admin ยืนยัน (Final Close) แล้ว</div>
      </div>
    </>
  )
}
