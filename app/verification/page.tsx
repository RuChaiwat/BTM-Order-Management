import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { AdminVerificationBoard } from '@/components/verification/AdminVerificationBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getVerificationData } from '@/lib/queries/verification'

export default async function AdminVerificationPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const data = await getVerificationData(admin, user.warehouse_code ?? 'DC002')

  return (
    <AppLayout activeNavId={16}>
      <TopBar title="Admin Verification" subtitle={`รอตรวจสอบยืนยัน (สำนักงาน) · ${data.queue.length} orders`} />
      <AdminVerificationBoard queue={data.queue} />
    </AppLayout>
  )
}
