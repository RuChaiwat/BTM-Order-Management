import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { ZoneDashboardBoard } from '@/components/zoneDashboard/ZoneDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getZoneDashboardData } from '@/lib/queries/zoneDashboard'

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
