import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { PickCompletionBoard } from '@/components/pickCompletion/PickCompletionBoard'
import { getSessionUser } from '@/lib/auth'
import { requireMenuAccess } from '@/lib/pageAccess'

export const dynamic = 'force-dynamic'

export default async function PickCompletionPage({ searchParams }: { searchParams: { picker_id?: string; order_id?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 8)

  return (
    <>
      <TopBar title="Pick Completion" subtitle={`ปิดงานหยิบแทนพนักงาน (สแกนรหัส Picker) · ${user.warehouse_code ?? ''}`} />
      <PickCompletionBoard autoPickerId={searchParams.picker_id} highlightOrderId={searchParams.order_id} />
    </>
  )
}
