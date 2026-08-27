import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { AdminVerificationBoard } from '@/components/verification/AdminVerificationBoard'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getVerificationData } from '@/lib/queries/verification'

export default async function AdminVerificationPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const supabase = await createClient()
  const data = await getVerificationData(supabase, user.warehouse_code ?? 'DC002')

  return (
    <AppLayout activeNavId={8}>
      <TopBar title="Waiting Admin Verification" subtitle={`รอตรวจสอบ · ${data.queue.length} orders · verification backlog`} />
      <AdminVerificationBoard queue={data.queue} active={data.active} shortPickReasons={data.shortPickReasons} />
    </AppLayout>
  )
}
