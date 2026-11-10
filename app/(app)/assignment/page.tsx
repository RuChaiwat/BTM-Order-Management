import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { WorkAssignmentBoard } from '@/components/assignment/WorkAssignmentBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAssignmentBacklogByDate } from '@/lib/queries/assignmentPool'
import { getActivePickers, getActiveEmploymentTypes } from '@/lib/queries/pickers'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getActiveConfig } from '@/lib/queries/config'
import { WORK_ASSIGNMENT_PRINT_KEY, type WorkAssignmentPrintDocument } from '@/lib/configCatalog'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function WorkAssignmentPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 7)
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  const [backlogByDate, pickers, employmentTypes, config] = await Promise.all([
    getAssignmentBacklogByDate(admin, warehouseCode),
    getActivePickers(admin, warehouseCode),
    getActiveEmploymentTypes(admin),
    getActiveConfig(admin, [WORK_ASSIGNMENT_PRINT_KEY]),
  ])
  // Global Configuration setting (Configuration > Printing); Pick Slip until it's been set.
  const printDocument: WorkAssignmentPrintDocument = config.value(WORK_ASSIGNMENT_PRINT_KEY) === 'pick_sheet' ? 'pick_sheet' : 'pick_slip'
  const labelByType = new Map(employmentTypes.map((t) => [t.type_code, t.label_en]))
  const pickersWithLabel = pickers.map((p) => ({ ...p, employment_type: p.employment_type ? labelByType.get(p.employment_type) ?? p.employment_type : null }))

  return (
    <>
      <TopBar title="Work Assignment" subtitle={`มอบหมายงาน · ${warehouseCode}`} />
      <WorkAssignmentBoard warehouseCode={warehouseCode} initialBacklogByDate={backlogByDate} pickers={pickersWithLabel} printDocument={printDocument} />
    </>
  )
}
