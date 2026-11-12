import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { BackButton } from '@/components/BackButton'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { PackQueueTable } from '@/components/packing/PackQueueTable'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getPackQueue } from '@/lib/queries/packing'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

export const dynamic = 'force-dynamic'

/** Drill-down from Packing Dashboard's "Waiting to pack" card -- same access as the dashboard
 * (menu 21), so it has no sidebar entry of its own. */
export default async function PackQueuePage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 21)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const [rows, refreshMs] = await Promise.all([getPackQueue(admin, warehouseCode), getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.packingDashboard)])
  const pieces = rows.reduce((s, r) => s + r.pieces, 0)

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Orders Waiting to Pack" subtitle={`รายการ order รอแพ็ก · ${rows.length.toLocaleString()} orders · ${pieces.toLocaleString()} ชิ้น · ${warehouseCode}`}>
        <BackButton fallbackHref="/packing-dashboard" />
        <ExportExcelButton href="/api/packing-queue/export" />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px' }}>
        <PackQueueTable rows={rows} />
      </div>
    </>
  )
}
