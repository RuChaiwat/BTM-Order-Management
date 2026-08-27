import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

const TRANSITIONS: Record<string, string> = {
  approve: 'approved',
  release: 'report_released',
  cancel: 'cancelled',
}

/** §9-11 consolidation batch lifecycle: candidate -> approved -> report_released (or cancelled). */
export async function PATCH(request: Request, { params }: { params: { batchId: string } }) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { action } = await request.json()
  const newStatus = TRANSITIONS[action]
  if (!newStatus) return NextResponse.json({ error: "action must be 'approve', 'release' or 'cancel'" }, { status: 400 })

  const admin = createAdminClient()
  const { data: batch } = await admin.from('consolidation_batches').select('*').eq('consol_batch_id', params.batchId).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  const patch: Record<string, unknown> = { status: newStatus }
  if (action === 'release') {
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
