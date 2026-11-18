import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { OperationsDashboardBoard } from '@/components/dashboard/OperationsDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardData } from '@/lib/queries/dashboard'
import { getProductivityData } from '@/lib/queries/productivity'
import { getBacklogData } from '@/lib/queries/backlog'
import { getLiveMonitorData, getPackingDashboardData, getPackingProductivity } from '@/lib/queries/packing'
import { getPackingSettings } from '@/lib/packing'
import { bangkokDateKey } from '@/lib/formatDate'
import { redirect } from 'next/navigation'
import { requireMenuAccess } from '@/lib/pageAccess'
import { canAccessMenuItem } from '@/lib/roles'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

/** Pick + Pack overview for managers. Each figure comes from the same query as the page that owns
 * it (Productivity & SLA, Packing Dashboard, Pending Actions Monitor) so the numbers always match. */
export default async function OperationsDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 1)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const todayKey = bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
  const [pick, refreshMs, pack, monitor, packSettings, packProd, pickProd, pending] = await Promise.all([
    getDashboardData(admin, warehouseCode),
    getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.operationsDashboard),
    getPackingDashboardData(admin, warehouseCode),
    getLiveMonitorData(admin, warehouseCode),
    getPackingSettings(admin),
    getPackingProductivity(admin, warehouseCode, todayKey),
    getProductivityData(admin, warehouseCode, todayKey),
    getBacklogData(admin, warehouseCode),
  ])
  const nowMs = Date.now()
  const minsSince = (iso: string) => Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000))

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Operations Dashboard" subtitle={`ภาพรวมงานหยิบและงานแพ็ก · ${warehouseCode}`}>
        <div className="control">
          <span style={{ fontWeight: 500 }}>{user.warehouse_code ?? '—'}</span>
        </div>
      </TopBar>

      <OperationsDashboardBoard
        pick={pick}
        pack={pack}
        pickAvg={{ rate: pickProd.kpis.avgPcsPerHour, target: pickProd.targetPcsPerHour }}
        packAvg={{ rate: packProd.totals.pcsPerHour, target: packSettings.targetPcsPerHour }}
        activeStations={new Set(monitor.live.map((s) => s.station_code)).size}
        idleStations={monitor.idleStations.length}
        packingMinutes={monitor.live.map((s) => minsSince(s.timer_from))}
        packBands={{ yellowMinutes: packSettings.yellowMinutes, redMinutes: packSettings.redMinutes }}
        pending={{
          pickingOrders: pending.summary.pickingBacklogOrders,
          pickingPieces: pending.summary.pickingBacklogPieces,
          verificationOrders: pending.summary.verificationBacklogOrders,
          verificationPieces: pending.summary.verificationBacklogPieces,
        }}
        access={{
          backlog: canAccessMenuItem(user.role, 11),
          verification: canAccessMenuItem(user.role, 16),
          packVerify: canAccessMenuItem(user.role, 23),
          packIssues: canAccessMenuItem(user.role, 24),
        }}
        todayKey={todayKey}
        nowMs={nowMs}
      />
    </>
  )
}
