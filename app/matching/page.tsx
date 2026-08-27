import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { MatchingBoard } from '@/components/matching/MatchingBoard'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getMatchingDashboardData } from '@/lib/queries/consolidation'

export default async function MatchingPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const supabase = await createClient()
  const { batches, unmatchedPendingCount } = await getMatchingDashboardData(supabase, warehouseCode)

  return (
    <AppLayout activeNavId={3}>
      <TopBar title="Matching Dashboard & Batch Review" subtitle={`แดชบอร์ดการจับคู่ / ตรวจแบตช์ · ${warehouseCode}`} />
      <MatchingBoard batches={batches} warehouseCode={warehouseCode} unmatchedPendingCount={unmatchedPendingCount} />
    </AppLayout>
  )
}
