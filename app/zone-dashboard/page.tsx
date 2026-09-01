import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { ZoneDashboardBoard } from '@/components/zoneDashboard/ZoneDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getZoneDashboardData } from '@/lib/queries/zoneDashboard'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function ZoneDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const data = await getZoneDashboardData(admin, warehouseCode)

  return (
    <AppLayout activeNavId={9}>
      <TopBar title="Zone Dashboard" subtitle={`แดชบอร์ดโซน · ${data.zoneDetail.length} zones · ${warehouseCode}`} />
      <ZoneDashboardBoard zoneDetail={data.zoneDetail} />
    </AppLayout>
  )
}
