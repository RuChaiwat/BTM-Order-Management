import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { PackIssueInbox } from '@/components/packing/PackIssueInbox'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getPackIssueList } from '@/lib/queries/packing'

export const dynamic = 'force-dynamic'

export default async function PackIssuesPage({ searchParams }: { searchParams: { issue?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 24)
  const since = new Date(Date.now() - 7 * 86400000).toISOString()
  const issues = await getPackIssueList(createAdminClient(), user.warehouse_code ?? 'DC002', since)
  const unresolved = issues.filter((i) => i.status !== 'resolved').length

  return (
    <>
      <AutoRefresh intervalMs={60_000} />
      <TopBar title="Pack Issue Investigation" subtitle={`ตรวจสอบปัญหาที่ Packer แจ้ง · ยังไม่ปิด ${unresolved.toLocaleString()} เรื่อง`} />
      <PackIssueInbox issues={issues} initialIssueId={searchParams.issue} />
    </>
  )
}
