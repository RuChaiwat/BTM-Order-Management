import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

// The lifecycle used to require two clicks (Approve, then Release) before a batch's pick report
// could be printed. Collapsed into a single "Approve" action that does both at once: it moves the
// batch straight to `report_released` (the status the UI labels "Approved" — see batchStatus.ts)
// and stamps released_at/report_generated_at immediately, since there's no longer a distinct
// review-then-release gap for the batch to sit in.
const TRANSITIONS: Record<string, string> = {
  approve: 'report_released',
  cancel: 'cancelled',
  complete: 'completed',
}

/** §9-11 consolidation batch lifecycle: candidate -> report_released ("Approved") -> ... -> completed (or cancelled). */
export async function PATCH(request: Request, { params }: { params: { batchId: string } }) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { action } = await request.json()
  const newStatus = TRANSITIONS[action]
  if (!newStatus) return NextResponse.json({ error: "action must be 'approve', 'cancel' or 'complete'" }, { status: 400 })

  const admin = createAdminClient()
  const { data: batch } = await admin.from('consolidation_batches').select('*').eq('consol_batch_id', params.batchId).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const patch: Record<string, unknown> = { status: newStatus }
  if (action === 'approve') {
    const now = new Date().toISOString()
    patch.released_at = now
    patch.report_generated_at = now
  }

  const { data: updated, error } = await admin.from('consolidation_batches').update(patch).eq('consol_batch_id', params.batchId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (action === 'cancel') {
    await admin.from('orders').update({ consolidation_batch_id: null }).eq('consolidation_batch_id', params.batchId)
  }

  await writeStatusHistory(admin, { entityType: 'consolidation_batches', entityId: params.batchId, oldStatus: batch.status, newStatus, changedBy: caller.user_id })
  await writeAudit(admin, { userId: caller.user_id, action: `consolidation_batch.${action}`, entityType: 'consolidation_batches', entityId: params.batchId, before: batch, after: updated })

  return NextResponse.json({ batch: updated })
}
