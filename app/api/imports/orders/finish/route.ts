import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'

/** Step 3 of the chunked order import flow: finalizes import_batches from the authoritative
 * import_errors rows already written by each batch call (not from client-supplied counts, so a
 * client bug can't corrupt the persisted record other screens read). orders_created/updated/
 * lines_upserted are accepted from the client purely for the audit log entry and the on-screen
 * summary — they aren't used for anything else that depends on being exact. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'planner_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { import_id, orders_created, orders_updated, lines_upserted } = await request.json()
  if (!import_id) return NextResponse.json({ error: 'import_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: importBatch } = await admin.from('import_batches').select('total_rows').eq('import_id', import_id).single()
  if (!importBatch) return NextResponse.json({ error: 'Import batch not found' }, { status: 404 })

  const { data: errorRows } = await admin.from('import_errors').select('severity').eq('import_id', import_id)
  const blockingCount = (errorRows ?? []).filter((e) => e.severity === 'blocking').length
  const warningCount = (errorRows ?? []).length - blockingCount
  const errorCount = blockingCount + warningCount
  const successRows = importBatch.total_rows - blockingCount
  const status = errorCount === 0 ? 'completed' : successRows === 0 ? 'failed' : 'completed_with_errors'

  await admin.from('import_batches').update({ status, success_rows: successRows, error_rows: errorCount, finished_at: new Date().toISOString() }).eq('import_id', import_id)

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'orders.import',
    entityType: 'import_batches',
    entityId: import_id,
    after: { orders_created: orders_created ?? null, orders_updated: orders_updated ?? null, lines_upserted: lines_upserted ?? null, errors: errorCount },
  })

  return NextResponse.json({ import_id, status, success_rows: successRows, error_count: errorCount, blocking_count: blockingCount, warning_count: warningCount })
}
