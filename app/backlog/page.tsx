import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { BacklogBoard } from '@/components/backlog/BacklogBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBacklogData } from '@/lib/queries/backlog'

export default async function BacklogPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const data = await getBacklogData(admin, warehouseCode)

  return (
    <AppLayout activeNavId={11}>
      <TopBar title="Backlog Monitor" subtitle={`งานคงค้าง · ${data.rows.length} orders backlogged`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard label="PICKING BACKLOG" value={data.summary.pickingBacklog} valueColor="#F59E0B" compact style={{ padding: 14 }} />
          <KpiCard label="VERIFICATION BACKLOG" value={data.summary.verificationBacklog} valueColor="#2563EB" compact style={{ padding: 14 }} />
          <KpiCard label="OVERDUE (45-120m)" value={data.summary.overdue} valueColor="#EA580C" compact style={{ padding: 14 }} />
          <KpiCard label="CRITICAL (120m+)" value={data.summary.critical} valueColor="#DC2626" compact style={{ padding: 14 }} />
        </div>
        <BacklogBoard rows={data.rows} />
      </div>
    </AppLayout>
  )
}
