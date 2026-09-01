import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBatchDetail, buildPickReportLines } from '@/lib/queries/consolidation'
import { PickReportBody, PICK_REPORT_PRINT_CSS } from '@/components/consolidation/PickReportBody'
import { AutoPrint } from '@/components/consolidation/AutoPrint'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

/** Opened in a new tab right after a bulk Approve in Matching Analysis & Batch Review — one
 * printable document covering every batch just approved, so approving several batches together
 * still only takes one trip to the printer. */
export default async function PickReportPrintPage({ searchParams }: { searchParams: { ids?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const ids = (searchParams.ids ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const admin = createAdminClient()

  const details = await Promise.all(ids.map((id) => getBatchDetail(admin, id)))
  const generatedAt = new Date().toLocaleString()

  const reports = details
    .map((detail) => {
      if (!detail) return null
      const { batch, orders, lines } = detail
      return {
        batch,
        warehouseCode: orders[0]?.warehouse_code ?? user.warehouse_code ?? '',
        uniqueSkuCount: new Set(lines.map((l) => l.sku)).size,
        zones: [...new Set(lines.map((l) => l.zone_code).filter(Boolean))].sort(),
        pickLines: buildPickReportLines(lines, orders),
      }
    })
    .filter((r): r is NonNullable<typeof r> => r !== null)

  return (
    <div>
      <style>{PICK_REPORT_PRINT_CSS}</style>
      {reports.length > 0 && <AutoPrint />}
      {reports.length === 0 && <div style={{ padding: 24, fontFamily: 'Arial, sans-serif' }}>No approved batches found to print.</div>}
      {reports.map((r, i) => (
        <PickReportBody key={r.batch.consol_batch_id} {...r} generatedAt={generatedAt} generatedByName={user.name_en} breakAfter={i < reports.length - 1} />
      ))}
    </div>
  )
}
