import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { PackVerifyBoard } from '@/components/packing/PackVerifyBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getPackVerifyQueue } from '@/lib/queries/packVerification'

export const dynamic = 'force-dynamic'

export default async function PackVerificationPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 23)
  const queue = await getPackVerifyQueue(createAdminClient(), user.warehouse_code ?? 'DC002')

  return (
    <>
      <TopBar title="Admin Pack Verify" subtitle={`ยืนยันการแพ็กหลังทำ Confirm Pack ใน WMS · ${queue.length.toLocaleString()} orders`} />
      <PackVerifyBoard queue={queue} />
    </>
  )
}
