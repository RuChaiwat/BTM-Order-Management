import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { ConsolidationPickReportBoard } from '@/components/consolidation/ConsolidationPickReportBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActivePickReportBatches } from '@/lib/queries/consolidationPickReport'

export default async function ConsolidationPickReportPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const { batches } = await getActivePickReportBatches(admin)

  const totalPieces = batches.reduce((s, b) => s + b.total_pieces, 0)
  const totalStores = batches.reduce((s, b) => s + b.stores_count, 0)
  const oldestAgeHours = batches[0]?.released_at ? Math.round((Date.now() - new Date(batches[0].released_at).getTime()) / 3600000) : null

  return (
    <AppLayout activeNavId={5}>
      <TopBar title="Consolidation Pick Report" subtitle={`รายงานหยิบรวม · ${batches.length} batch(es) active at consolidation`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          <KpiCard label="ACTIVE BATCHES" value={batches.length} compact style={{ padding: 14 }} />
          <KpiCard label="TOTAL PIECES" value={totalPieces} compact style={{ padding: 14 }} />
          <KpiCard label="TOTAL STORES" value={totalStores} compact style={{ padding: 14 }} />
          <KpiCard label="OLDEST RELEASE" value={oldestAgeHours !== null ? `${oldestAgeHours}h` : '—'} valueColor={oldestAgeHours !== null && oldestAgeHours > 24 ? '#DC2626' : undefined} compact style={{ padding: 14 }} />
        </div>
        <ConsolidationPickReportBoard batches={batches} />
      </div>
    </AppLayout>
  )
}
