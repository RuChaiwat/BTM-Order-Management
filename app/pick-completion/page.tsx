import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { PickCompletionBoard } from '@/components/pickCompletion/PickCompletionBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickCompletionData } from '@/lib/queries/pickCompletion'

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
