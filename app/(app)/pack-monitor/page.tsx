import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { LivePackMonitor } from '@/components/packing/LivePackMonitor'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getLiveMonitorData } from '@/lib/queries/packing'
import { cancelStalePackSessions, getPackingSettings } from '@/lib/packing'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

export const dynamic = 'force-dynamic'

export default async function PackMonitorPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 22)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  // No packing carries over to a new day -- safety net for the midnight cron.
  await cancelStalePackSessions(admin)
  const [data, settings, refreshMs] = await Promise.all([getLiveMonitorData(admin, warehouseCode), getPackingSettings(admin), getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.livePackingMonitor, 1)])

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Live Packing Monitor" subtitle={`ติดตามการแพ็กแบบเรียลไทม์ · ${warehouseCode}`} />
      <LivePackMonitor live={data.live} idleStations={data.idleStations} bands={{ yellowMinutes: settings.yellowMinutes, redMinutes: settings.redMinutes }} canCancel={['system_admin', 'pack_supervisor'].includes(user.role)} />
    </>
  )
}
