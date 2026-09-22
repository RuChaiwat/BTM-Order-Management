import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

// The lifecycle used to require two clicks (Approve, then Release) before a batch's pick report
// could be printed. Collapsed into a single "Approve" action that does both at once: it moves the
// batch straight to `report_released` (the status the UI labels "Approved" — see batchStatus.ts)
// and stamps released_at/report_generated_at immediately, since there's no longer a distinct
// review-then-release gap for the batch to sit in.
//
// Approve now ALSO requires a picker_id and creates a real assignment_batches row for the batch's
// orders (migration 0027) -- otherwise those orders sat at status='new' forever, invisible to Pick
// Completion, Admin Verification, and every dashboard that tracks active picking work. See that
// migration's own comment for the full reasoning.
const SIMPLE_TRANSITIONS: Record<string, string> = {
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

  const { action, picker_id: pickerId } = await request.json()
  if (action !== 'approve' && !SIMPLE_TRANSITIONS[action]) {
    return NextResponse.json({ error: "action must be 'approve', 'cancel' or 'complete'" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: batch } = await admin.from('consolidation_batches').select('*').eq('consol_batch_id', params.batchId).single()
  if (!batch) return NextResponse.json({ error: 'Batch not found' }, { status: 404 })

  if (action === 'approve') {
    if (!pickerId) return NextResponse.json({ error: 'picker_id is required to approve a batch' }, { status: 400 })

    const warehouseCode = caller.warehouse_code ?? 'DC002'
    const { data: picker, error: pickerError } = await admin.from('pickers').select('picker_id, name_en, active, warehouse_code').eq('picker_id', pickerId).maybeSingle()
    if (pickerError) return NextResponse.json({ error: pickerError.message }, { status: 400 })
    if (!picker || !picker.active) return NextResponse.json({ error: 'Picker not found or inactive — re-scan the badge' }, { status: 400 })
    if (picker.warehouse_code && picker.warehouse_code !== warehouseCode) {
      return NextResponse.json({ error: 'This Picker belongs to a different warehouse' }, { status: 400 })
    }

    const { data: rpcResult, error: rpcError } = await admin.rpc('approve_consolidation_batch', {
      p_consol_batch_id: params.batchId,
      p_picker_id: pickerId,
      p_admin_id: caller.user_id,
    })
    if (rpcError) {
      if (rpcError.message.includes('NO_ORDERS_IN_BATCH')) {
        return NextResponse.json({ error: 'This batch has no orders left to assign — it may have already been cancelled or reassigned' }, { status: 409 })
      }
      if (rpcError.message.includes('ORDER_NOT_AVAILABLE')) {
        return NextResponse.json({ error: 'One or more orders in this batch were just assigned elsewhere — refresh and try again' }, { status: 409 })
      }
      return NextResponse.json({ error: rpcError.message }, { status: 400 })
    }
    const assignmentBatch = Array.isArray(rpcResult) ? rpcResult[0] : rpcResult

    const { data: updated } = await admin.from('consolidation_batches').select('*').eq('consol_batch_id', params.batchId).single()

    await writeStatusHistory(admin, { entityType: 'consolidation_batches', entityId: params.batchId, oldStatus: batch.status, newStatus: 'report_released', changedBy: caller.user_id })
    await writeAudit(admin, {
      userId: caller.user_id,
      action: 'consolidation_batch.approve',
      entityType: 'consolidation_batches',
      entityId: params.batchId,
      before: batch,
      after: { ...updated, assignment_batch_id: assignmentBatch?.assignment_batch_id, picker_id: pickerId },
    })

    return NextResponse.json({ batch: updated, assignment_batch: assignmentBatch })
  }

  const newStatus = SIMPLE_TRANSITIONS[action]
  const { data: updated, error } = await admin.from('consolidation_batches').update({ status: newStatus }).eq('consol_batch_id', params.batchId).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  if (action === 'cancel') {
    await admin.from('orders').update({ consolidation_batch_id: null }).eq('consolidation_batch_id', params.batchId)
  }

  await writeStatusHistory(admin, { entityType: 'consolidation_batches', entityId: params.batchId, oldStatus: batch.status, newStatus, changedBy: caller.user_id })
  await writeAudit(admin, { userId: caller.user_id, action: `consolidation_batch.${action}`, entityType: 'consolidation_batches', entityId: params.batchId, before: batch, after: updated })

  return NextResponse.json({ batch: updated })
}
