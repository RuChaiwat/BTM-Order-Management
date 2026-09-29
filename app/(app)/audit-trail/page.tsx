import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AuditTrailDateFilter } from '@/components/admin/AuditTrailDateFilter'
import { AuditTrailBoard } from '@/components/admin/AuditTrailBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAuditTrail } from '@/lib/queries/auditTrail'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function AuditTrailPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const date = searchParams.date || bangkokDateKey(new Date()) || new Date().toISOString().slice(0, 10)
  const rows = await getAuditTrail(admin, date)

  return (
    <>
      <TopBar title="Audit Trail" subtitle={`ประวัติการตรวจสอบ (§23) · ${formatDate(date)} · ${rows.length} action(s)`}>
        <AuditTrailDateFilter date={date} />
      </TopBar>
      <div className="page-body">
        {/* No minHeight:0 -- .app-shell is a fixed 100vh flex column, so a flex item allowed to
            shrink below its content gets squeezed by the flex algorithm once total page content
            exceeds the viewport (same fix as Consolidation Pick Report/Zone Dashboard). This is
            the only card on the page, so it's the one allowed to claim flex:1. */}
        <div className="card" style={{ flex: 1, minHeight: 0 }}>
          <div className="card-title">Audit Trail</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            Immutable — System Admin / Warehouse Manager only. Purged after the configured retention window (Configuration page), same as other transactional data.
          </div>
          <AuditTrailBoard rows={rows} />
        </div>
      </div>
    </>
  )
}
