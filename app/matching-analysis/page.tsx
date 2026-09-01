import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { MatchingBoard } from '@/components/matching/MatchingBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatchingDashboardData } from '@/lib/queries/consolidation'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

function yesterday() {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

export default async function MatchingAnalysisPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const orderDate = searchParams.date ?? yesterday()
  const admin = createAdminClient()
  const { batches, unmatchedPendingCount } = await getMatchingDashboardData(admin, warehouseCode, orderDate)

  return (
    <AppLayout activeNavId={4}>
      <TopBar title="Matching Analysis & Batch Review" subtitle={`วิเคราะห์การจับคู่ / ตรวจแบตช์ · ${warehouseCode}`} />
      <MatchingBoard batches={batches} warehouseCode={warehouseCode} unmatchedPendingCount={unmatchedPendingCount} orderDate={orderDate} />
    </AppLayout>
  )
}
