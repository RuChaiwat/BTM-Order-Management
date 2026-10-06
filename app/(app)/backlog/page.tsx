import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { BacklogBoard } from '@/components/backlog/BacklogBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBacklogData } from '@/lib/queries/backlog'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function BacklogPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const data = await getBacklogData(admin, warehouseCode)

  return (
    <>
      <AutoRefresh />
      <TopBar title="Pending Actions Monitor" subtitle={`รายการที่ต้องดำเนินการ · ${data.rows.length} orders pending action`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard
            label="PICKING PENDING (PCS)"
            labelTh="รอ Picker ดำเนินการ (ชิ้น)"
            value={data.summary.pickingBacklogPieces.toLocaleString()}
            sub={`${data.summary.pickingBacklogOrders.toLocaleString()} orders`}
            valueColor="#F59E0B"
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="VERIFICATION PENDING (PCS)"
            labelTh="รอ Admin ตรวจสอบ (ชิ้น)"
            value={data.summary.verificationBacklogPieces.toLocaleString()}
            sub={`${data.summary.verificationBacklogOrders.toLocaleString()} orders`}
            valueColor="#2563EB"
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="OVERDUE (PCS)"
            labelTh="เกินกำหนด (ชิ้น)"
            value={data.summary.overduePieces.toLocaleString()}
            sub={`${data.summary.overdueOrders.toLocaleString()} orders`}
            valueColor="#EA580C"
            compact
            style={{ padding: 14 }}
          />
          <KpiCard
            label="CRITICAL (PCS)"
            labelTh="วิกฤต (ชิ้น)"
            value={data.summary.criticalPieces.toLocaleString()}
            sub={`${data.summary.criticalOrders.toLocaleString()} orders`}
            valueColor="#DC2626"
            compact
            style={{ padding: 14 }}
          />
        </div>
        <BacklogBoard rows={data.rows} />
      </div>
    </>
  )
}
