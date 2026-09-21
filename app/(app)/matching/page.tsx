import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { MatchingDateFilter } from '@/components/matching/MatchingDateFilter'
import { MatchingDashboardBoard } from '@/components/matching/MatchingDashboardBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatchingOverviewData } from '@/lib/queries/matchingOverview'
import { getMostRecentOrderDate } from '@/lib/queries/orderDates'

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

export default async function MatchingDashboardPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const orderDate = searchParams.date || (await getMostRecentOrderDate(admin, warehouseCode)) || yesterday()
  const data = await getMatchingOverviewData(admin, warehouseCode, orderDate)

  return (
    <>
      <TopBar title="Matching Dashboard" subtitle={`แดชบอร์ดการจับคู่ · ${warehouseCode}`}>
        <MatchingDateFilter orderDate={orderDate} />
      </TopBar>
      <MatchingDashboardBoard data={data} />
    </>
  )
}
