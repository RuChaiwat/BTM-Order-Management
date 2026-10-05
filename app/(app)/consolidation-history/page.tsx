import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { ConsolidationHistoryFilter } from '@/components/consolidation/ConsolidationHistoryFilter'
import { ConsolidationHistoryBoard } from '@/components/consolidation/ConsolidationHistoryBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConsolidationHistory, type ConsolidationHistorySearchField } from '@/lib/queries/consolidationHistory'
import { bangkokDateKey } from '@/lib/formatDate'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

const VALID_FIELDS: ConsolidationHistorySearchField[] = ['released', 'order_date', 'batch_no']

export default async function ConsolidationHistoryPage({ searchParams }: { searchParams: { field?: string; date?: string; q?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()

  const field: ConsolidationHistorySearchField = VALID_FIELDS.includes(searchParams.field as ConsolidationHistorySearchField)
    ? (searchParams.field as ConsolidationHistorySearchField)
    : 'released'
  const date = searchParams.date || bangkokDateKey(new Date()) || new Date().toISOString().slice(0, 10)
  const batchNo = searchParams.q ?? ''

  const rows = await getConsolidationHistory(admin, { field, date, batchNo })

  return (
    <>
      <AutoRefresh />
      <TopBar title="Consolidation History" subtitle="ประวัติการรวมออเดอร์ · released, completed and cancelled batches">
        <ConsolidationHistoryFilter field={field} date={date} batchNo={batchNo} />
      </TopBar>
      <div className="page-body">
        <ConsolidationHistoryBoard rows={rows} />
      </div>
    </>
  )
}
