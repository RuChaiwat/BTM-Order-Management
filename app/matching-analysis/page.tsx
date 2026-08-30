import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { MatchingBoard } from '@/components/matching/MatchingBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getMatchingDashboardData } from '@/lib/queries/consolidation'

export default async function MatchingAnalysisPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const { batches, unmatchedPendingCount } = await getMatchingDashboardData(admin, warehouseCode)

  return (
    <AppLayout activeNavId={4}>
      <TopBar title="Matching Analysis & Batch Review" subtitle={`วิเคราะห์การจับคู่ / ตรวจแบตช์ · ${warehouseCode}`} />
      <MatchingBoard batches={batches} warehouseCode={warehouseCode} unmatchedPendingCount={unmatchedPendingCount} />
    </AppLayout>
  )
}
