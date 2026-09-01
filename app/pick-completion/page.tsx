import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { PickCompletionBoard } from '@/components/pickCompletion/PickCompletionBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickCompletionData } from '@/lib/queries/pickCompletion'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function PickCompletionPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const data = await getPickCompletionData(admin, warehouseCode, user)

  return (
    <AppLayout activeNavId={8}>
      <TopBar title="Pick Completion" subtitle={`บันทึกผลการหยิบที่หน้างาน · ${data.orders.length} orders in progress`} />
      <PickCompletionBoard orders={data.orders} lines={data.lines} shortPickReasons={data.shortPickReasons} />
    </AppLayout>
  )
}
