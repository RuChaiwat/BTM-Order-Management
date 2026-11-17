import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { ConsolidationPickReportBoard } from '@/components/consolidation/ConsolidationPickReportBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActivePickReportBatches } from '@/lib/queries/consolidationPickReport'
import { requireMenuAccess } from '@/lib/pageAccess'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function ConsolidationPickReportPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 5)
  const admin = createAdminClient()
  const { batches, kpis } = await getActivePickReportBatches(admin)

  return (
    <>
      <AutoRefresh />
      <TopBar title="Consolidation Pick Report" subtitle={`รายงานหยิบรวม · ${batches.length} batch`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard label="ACTIVE BATCHES" labelTh="Batch ที่กำลังดำเนินการ (batch)" value={kpis.activeBatches.toLocaleString()} compact style={{ padding: 14 }} />
          <KpiCard
            label="TOTAL PIECES (PCS)"
            labelTh="จำนวนชิ้นทั้งหมด (ชิ้น)"
            value={kpis.totalPieces.toLocaleString()}
            sub={`${kpis.totalOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard label="TOTAL STORES" labelTh="จำนวนร้านค้าทั้งหมด (ร้าน)" value={kpis.totalStores.toLocaleString()} compact style={{ padding: 14 }} />
          <KpiCard
            label="ORDERS PENDING COMPLETION (PCS)"
            labelTh="Order ที่ยังไม่ปิดงาน รอหยิบ/ตรวจสอบ (ชิ้น)"
            value={kpis.pendingCompletionPieces.toLocaleString()}
            valueColor={kpis.pendingCompletionPieces > 0 ? '#F59E0B' : undefined}
            sub={`${kpis.pendingCompletionOrders.toLocaleString()} order`}
            compact
            style={{ padding: 14 }}
          />
        </div>
        <ConsolidationPickReportBoard batches={batches} />
      </div>
    </>
  )
}
