import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getBatchDetail, buildPickReportLines } from '@/lib/queries/consolidation'
import { BatchReportDocument, PICK_REPORT_PRINT_CSS } from '@/components/consolidation/BatchReportDocument'
import { PrintButton } from '@/components/PrintButton'
import { batchStatusLabel, isBatchPrintable } from '@/lib/matching/batchStatus'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function PickReportPage({ params }: { params: { batchId: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()
  const detail = await getBatchDetail(admin, params.batchId)
  if (!detail) notFound()

  const { batch, orders, lines } = detail
  const pickLines = buildPickReportLines(lines, orders)
  const printable = isBatchPrintable(batch.status)

  return (
    <div>
      <style>{PICK_REPORT_PRINT_CSS}</style>

      <div className="no-print" style={{ marginBottom: 16, maxWidth: 800, margin: '0 auto 16px' }}>
        {printable ? (
          <PrintButton />
        ) : (
          <div style={{ fontSize: 12.5, color: '#B45309', background: '#FFFBEB', border: '1px solid #FED7AA', borderRadius: 8, padding: '8px 12px', display: 'inline-block' }}>
            This batch is <strong>{batchStatusLabel(batch.status)}</strong> — approve it in Matching Analysis &amp; Batch Review before printing.
          </div>
        )}
      </div>

      <BatchReportDocument
        batch={batch}
        warehouseCode={orders[0]?.warehouse_code ?? user.warehouse_code ?? ''}
        orders={orders}
        pickLines={pickLines}
        generatedAt={new Date().toLocaleString()}
        generatedByName={user.name_en}
      />
    </div>
  )
}
