import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { ProductivityDateFilter } from '@/components/productivity/ProductivityDateFilter'
import { ProductivityBoard } from '@/components/productivity/ProductivityBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getProductivityData } from '@/lib/queries/productivity'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function ProductivityPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const date = searchParams.date || bangkokDateKey(new Date()) || new Date().toISOString().slice(0, 10)
  const data = await getProductivityData(admin, warehouseCode, date)

  return (
    <>
      <TopBar title="Productivity / SLA / Short Pick" subtitle={`ผลิตภาพ / SLA / หยิบขาด · ${formatDate(date)} · ${warehouseCode}`}>
        <ProductivityDateFilter date={date} />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard
            label="ORDERS COMPLETED (PCS)"
            labelTh="Picker ยืนยันเสร็จแล้ว"
            value={data.kpis.totalPieces.toLocaleString()}
            valueColor="#16A34A"
            sub={`${data.kpis.completedOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="AVG PCS / HOUR"
            labelTh="อัตราหยิบเฉลี่ย (ชิ้น/ชม.)"
            value={data.kpis.avgPcsPerHour ?? '—'}
            sub={`target ${data.targetPcsPerHour.toLocaleString()} pcs/hr`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="SLA COMPLIANCE"
            labelTh="อัตราปฏิบัติตาม SLA"
            value={data.kpis.slaPct !== null ? `${data.kpis.slaPct}%` : '—'}
            valueColor={data.kpis.slaPct !== null && data.kpis.slaPct < 85 ? '#DC2626' : '#16A34A'}
            sub="cycle time ≤ 120 min"
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="SHORT PICK RATE"
            labelTh="อัตราหยิบขาด (Short Pick)"
            value={data.kpis.shortRatePct !== null ? `${data.kpis.shortRatePct}%` : '—'}
            valueColor={data.kpis.shortRatePct !== null && data.kpis.shortRatePct > 5 ? '#F59E0B' : undefined}
            sub={`${data.kpis.completedOrders.toLocaleString()} orders completed`}
            compact
            style={{ padding: 14 }}
          />
        </div>

        <ProductivityBoard
          pickerRows={data.pickerRows}
          reasonBreakdown={data.reasonBreakdown}
          topAboveTarget={data.topAboveTarget}
          bottomPerformers={data.bottomPerformers}
          targetPcsPerHour={data.targetPcsPerHour}
          date={date}
          warehouseCode={warehouseCode}
        />
      </div>
    </>
  )
}
