import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { OperationsDashboardBoard, type PickLevel } from '@/components/dashboard/OperationsDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getDashboardData } from '@/lib/queries/dashboard'
import { getProductivityData } from '@/lib/queries/productivity'
import { getBacklogData } from '@/lib/queries/backlog'
import { getLiveMonitorData, getPackIssueList, getPackingDashboardData, getPackingProductivity } from '@/lib/queries/packing'
import { getPackVerifyQueue } from '@/lib/queries/packVerification'
import { getPackingSettings, packTimeBand } from '@/lib/packing'
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
  const [pick, refreshMs, pack, monitor, packSettings, packProd, pickProd, pending, verifyQueue, issueList] = await Promise.all([
    getDashboardData(admin, warehouseCode),
    getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.operationsDashboard),
    getPackingDashboardData(admin, warehouseCode),
    getLiveMonitorData(admin, warehouseCode),
    getPackingSettings(admin),
    getPackingProductivity(admin, warehouseCode, todayKey),
    getProductivityData(admin, warehouseCode, todayKey),
    getBacklogData(admin, warehouseCode),
    getPackVerifyQueue(admin, warehouseCode),
    // resolvedSince = now -> open/investigating issues only
    getPackIssueList(admin, warehouseCode, new Date().toISOString()),
  ])
  const nowMs = Date.now()
  const minsSince = (iso: string) => Math.max(0, Math.round((nowMs - new Date(iso).getTime()) / 60000))

  // Action required colours: the worst time status among each box's orders (= the longest wait).
  const RANK: PickLevel[] = ['green', 'warning', 'overdue', 'critical']
  const pickWorst = (rows: typeof pending.rows) => {
    let level: PickLevel = 'green'
    let oldest = 0
    for (const r of rows) {
      const a = (r.alert?.time_alert ?? 'green') as PickLevel
      if (RANK.indexOf(a) > RANK.indexOf(level)) level = a
      oldest = Math.max(oldest, Math.round(r.alert?.elapsed_minutes ?? 0))
    }
    return { level, oldest }
  }
  const packWorst = (minutes: number[]) => {
    const oldest = minutes.length ? Math.max(...minutes) : 0
    return { level: minutes.length ? packTimeBand(oldest, packSettings) : ('green' as const), oldest }
  }
  const actionAlerts = {
    picking: pickWorst(pending.rows.filter((r) => r.alert?.is_picking_backlog)),
    verify: pickWorst(pending.rows.filter((r) => r.alert?.is_verification_backlog)),
    awaiting: packWorst(verifyQueue.map((o) => o.waitMinutes)),
    issues: packWorst(issueList.filter((i) => i.status !== 'resolved').map((i) => minsSince(i.reported_at))),
  }

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
        actionAlerts={actionAlerts}
        todayKey={todayKey}
        nowMs={nowMs}
      />
    </>
  )
}
