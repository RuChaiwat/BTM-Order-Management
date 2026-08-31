import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { processOrderRowsBatch, type RawImportRow } from '@/lib/importers/processOrderRows'

/** Step 2 of the chunked order import flow, called once per batch of order-groups so the client
 * can show real progress (batches completed / total batches) instead of just upload-transfer %,
 * which for a small file completes almost instantly while the actual row-by-row DB writes are
 * still the slow part. */
export async function POST(request: Request) {
  try {
    await requireRole(['system_admin', 'planner_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { import_id, rows } = (await request.json()) as { import_id?: string; rows?: RawImportRow[] }
  if (!import_id || !Array.isArray(rows)) {
    return NextResponse.json({ error: 'import_id and rows[] are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const result = await processOrderRowsBatch(admin, import_id, rows)

  return NextResponse.json({
    orders_created: result.ordersCreated,
    orders_updated: result.ordersUpdated,
    lines_upserted: result.linesUpserted,
    errors: result.errors.map((e) => ({ row_number: e.rowNumber, reason: e.reason, severity: e.severity })),
  })
}
