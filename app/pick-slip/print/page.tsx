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
 * order, so the picker walks off with a physical count of how many orders they were handed
 * (design approved separately; §12.1 confirm step). Also reachable any time afterward from Pick
 * Completion's "Reprint Slip" / "Reprint All" buttons for a paper jam, an empty roll, or a picker
 * who lost the slip -- same route, same `order_ids` param, just called again later. */
export default async function PickSlipPrintPage({ searchParams }: { searchParams: { order_ids?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const orderIds = (searchParams.order_ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const slips = orderIds.length ? await getPickSlipData(createAdminClient(), orderIds) : []

  return (
    <div>
      <style>{PICK_SLIP_PRINT_CSS}</style>
      {slips.length === 0 && <div className="no-print">No orders found to print.</div>}
      {slips.length > 0 && (
        <>
          <PickSlipDocument slips={slips} />
          <AutoPrint />
        </>
      )}
    </div>
  )
}
