import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { OperationsDashboardBoard } from '@/components/dashboard/OperationsDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardData } from '@/lib/queries/dashboard'
import { redirect } from 'next/navigation'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function OperationsDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 1)
  const admin = createAdminClient()
  const [data, refreshMs] = await Promise.all([
    getDashboardData(admin, user.warehouse_code ?? 'DC002'),
    getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.operationsDashboard),
  ])

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Operations Dashboard" subtitle={`ภาพรวมการดำเนินงาน · ${user.warehouse_code ?? ''}`}>
        <div className="control">
          <span style={{ fontWeight: 500 }}>{user.warehouse_code ?? '—'}</span>
        </div>
      </TopBar>

      <OperationsDashboardBoard data={data} />
    </>
  )
}
