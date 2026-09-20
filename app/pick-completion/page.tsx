import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { PickCompletionBoard } from '@/components/pickCompletion/PickCompletionBoard'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function PickCompletionPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <AppLayout activeNavId={8} user={user}>
      <TopBar title="Pick Completion" subtitle={`ปิดงานหยิบแทนพนักงาน (สแกนรหัส Picker) · ${user.warehouse_code ?? ''}`} />
      <PickCompletionBoard />
    </AppLayout>
  )
}
