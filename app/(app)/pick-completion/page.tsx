import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { PickCompletionBoard } from '@/components/pickCompletion/PickCompletionBoard'
import { getSessionUser } from '@/lib/auth'

export const dynamic = 'force-dynamic'

export default async function PickCompletionPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <>
      <TopBar title="Pick Completion" subtitle={`ปิดงานหยิบแทนพนักงาน (สแกนรหัส Picker) · ${user.warehouse_code ?? ''}`} />
      <PickCompletionBoard />
    </>
  )
}
