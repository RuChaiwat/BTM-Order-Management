import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { WorkAssignmentBoard } from '@/components/assignment/WorkAssignmentBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAssignmentBacklogByDate } from '@/lib/queries/assignmentPool'
import { getActivePickers, getActiveEmploymentTypes } from '@/lib/queries/pickers'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function WorkAssignmentPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  const [backlogByDate, pickers, employmentTypes] = await Promise.all([
    getAssignmentBacklogByDate(admin, warehouseCode),
    getActivePickers(admin, warehouseCode),
    getActiveEmploymentTypes(admin),
  ])
  const labelByType = new Map(employmentTypes.map((t) => [t.type_code, t.label_en]))
  const pickersWithLabel = pickers.map((p) => ({ ...p, employment_type: p.employment_type ? labelByType.get(p.employment_type) ?? p.employment_type : null }))

  return (
    <>
      <TopBar title="Work Assignment" subtitle={`มอบหมายงาน · ${warehouseCode}`} />
      <WorkAssignmentBoard warehouseCode={warehouseCode} initialBacklogByDate={backlogByDate} pickers={pickersWithLabel} />
    </>
  )
}
