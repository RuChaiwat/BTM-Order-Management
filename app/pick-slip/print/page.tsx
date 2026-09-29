import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickSlipData } from '@/lib/queries/pickSlip'
import { PickSlipDocument, PICK_SLIP_PRINT_CSS } from '@/components/assignment/PickSlipDocument'
import { AutoPrint } from '@/components/consolidation/AutoPrint'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

/** Opened in a new tab right after Confirm Assignment (Work Assignment) -- one 80mm slip per
 * order in the batch, so the picker walks off with a physical count of how many orders they were
 * handed (design approved separately; §12.1 confirm step). */
export default async function PickSlipPrintPage({ searchParams }: { searchParams: { assignment_batch_id?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const assignmentBatchId = searchParams.assignment_batch_id
  const data = assignmentBatchId ? await getPickSlipData(createAdminClient(), assignmentBatchId) : null

  return (
    <div>
      <style>{PICK_SLIP_PRINT_CSS}</style>
      {!data && <div className="no-print">No assignment batch found to print.</div>}
      {data && <PickSlipDocument slips={data.slips} warehouseCode={data.warehouseCode} pickerName={data.pickerName} />}
      {data && data.slips.length > 0 && <AutoPrint />}
    </div>
  )
}
