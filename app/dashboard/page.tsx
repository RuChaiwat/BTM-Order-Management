import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { OperationsDashboardBoard } from '@/components/dashboard/OperationsDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardData } from '@/lib/queries/dashboard'
import { redirect } from 'next/navigation'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function OperationsDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const data = await getDashboardData(admin, user.warehouse_code ?? 'DC002')

  return (
    <AppLayout activeNavId={1}>
      <TopBar title="Operations Dashboard" subtitle={`ภาพรวมการดำเนินงาน · ${user.warehouse_code ?? ''}`}>
        <div className="control">
          <span style={{ fontWeight: 500 }}>{user.warehouse_code ?? '—'}</span>
        </div>
      </TopBar>

      <OperationsDashboardBoard data={data} />
    </AppLayout>
  )
}
