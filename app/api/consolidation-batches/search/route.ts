import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getConsolidationHistory } from '@/lib/queries/consolidationHistory'

/** GET ?q=XXX -- backs Print & Reprint's Order Consolidation Report tab: search by Batch No (same
 * query Consolidation History's own Batch No search uses) so an already-released/completed batch
 * can be found again to reprint its report, without navigating through that page's date filters. */
export async function GET(request: Request) {
  try {
    await requireRole(['system_admin', 'warehouse_manager', 'supervisor', 'zone_controller'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const q = searchParams.get('q')?.trim() ?? ''
  if (!q) return NextResponse.json({ batches: [] })

  const admin = createAdminClient()
  const batches = await getConsolidationHistory(admin, { field: 'batch_no', batchNo: q })
  return NextResponse.json({ batches })
}
