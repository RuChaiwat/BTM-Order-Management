import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickSheetData } from '@/lib/queries/pickSheet'
import { PickSheetDocument, PICK_SHEET_PRINT_CSS } from '@/components/pickSheet/PickSheetDocument'
import { AutoPrint } from '@/components/consolidation/AutoPrint'
import { formatDateTime } from '@/lib/formatDate'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

/** Reached from Print & Reprint -- one (or more, paginated) A5 sheet per requested order, item
 * list sorted by Picking Sequence. Same `order_ids` query-string convention as /pick-slip/print so
 * both documents can be offered for the same selection. Auto-fires window.print() on load like
 * every other print route in this app (AutoPrint) -- whether that comes up as a silent print or
 * shows the OS picker depends entirely on the browser instance's own --kiosk-printing setting, not
 * on this page, so Print & Reprint should be used from an ordinary (non-kiosk) browser/workstation
 * if the point is choosing a different printer per document (see Print & Reprint's own page note). */
export default async function PickSheetPrintPage({ searchParams }: { searchParams: { order_ids?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const orderIds = (searchParams.order_ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const sheets = orderIds.length ? await getPickSheetData(createAdminClient(), orderIds) : []
  const generatedAt = formatDateTime(new Date())

  return (
    <div>
      <style>{PICK_SHEET_PRINT_CSS}</style>
      {sheets.length === 0 && <div className="no-print">No orders found to print.</div>}
      {sheets.length > 0 && (
        <>
          <PickSheetDocument sheets={sheets} generatedAt={generatedAt} />
          <AutoPrint />
        </>
      )}
    </div>
  )
}
