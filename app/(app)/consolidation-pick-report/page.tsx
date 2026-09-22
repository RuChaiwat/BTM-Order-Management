import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { ConsolidationPickReportBoard } from '@/components/consolidation/ConsolidationPickReportBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActivePickReportBatches } from '@/lib/queries/consolidationPickReport'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function ConsolidationPickReportPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { batches, kpis } = await getActivePickReportBatches(admin)

  return (
    <>
      <TopBar title="Consolidation Pick Report" subtitle={`รายงานหยิบรวม · ${batches.length} batch(es) active at consolidation`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard label="ACTIVE BATCHES" labelTh="แบตช์ที่กำลังดำเนินการ" value={kpis.activeBatches.toLocaleString()} sub="batches" compact style={{ padding: 14 }} />
          <KpiCard
            label="TOTAL PIECES (PCS)"
            labelTh="จำนวนชิ้นทั้งหมด"
            value={kpis.totalPieces.toLocaleString()}
            sub={`${kpis.totalOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard label="TOTAL STORES" labelTh="จำนวนร้านค้าทั้งหมด" value={kpis.totalStores.toLocaleString()} sub="stores" compact style={{ padding: 14 }} />
          <KpiCard
            label="ORDERS PENDING COMPLETION (PCS)"
            labelTh="ออเดอร์ที่ยังไม่ปิดงาน (รอหยิบ/ตรวจสอบ)"
            value={kpis.pendingCompletionPieces.toLocaleString()}
            valueColor={kpis.pendingCompletionPieces > 0 ? '#F59E0B' : undefined}
            sub={`${kpis.pendingCompletionOrders.toLocaleString()} orders`}
            compact
            style={{ padding: 14 }}
          />
        </div>
        <ConsolidationPickReportBoard batches={batches} />
      </div>
    </>
  )
}
