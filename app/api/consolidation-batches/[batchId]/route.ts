import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'
import { PENDING_BATCH_STATUSES, cancelPendingConsolidationBatch } from '@/lib/consolidationCleanup'

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
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])

/** §9-11 consolidation batch lifecycle: candidate -> report_released ("Approved") -> ... -> completed (or cancelled). */
export async function PATCH(request: Request, { params }: { params: { batchId: string } }) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { action, picker_id: pickerId, result } = await request.json()
  if (!['approve', 'complete', 'cancel'].includes(action)) {
    return NextResponse.json({ error: "action must be 'approve', 'complete' or 'cancel'" }, { status: 400 })
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

  if (action === 'complete') {
    if (!['100_percent', 'short'].includes(result ?? '')) {
      return NextResponse.json({ error: "result must be '100_percent' or 'short'" }, { status: 400 })
    }

    // Mirrors POST /api/picker-completions: marking a batch "Completed" previously only ever
    // touched consolidation_batches.status, leaving every order inside it stuck at
    // assigned/in_progress forever -- invisible to Admin Verification and every dashboard that
    // tracks active picking work, exactly the same gap migration 0027 closed for Approve. Orders
    // already past picking (picker_completed_*, final_closed_*, cancelled) are left alone.
    const { data: batchOrders } = await admin.from('orders').select('order_id, status, planned_pieces').eq('consolidation_batch_id', params.batchId)
    const activeOrders = (batchOrders ?? []).filter((o) => ACTIVE_ORDER_STATUSES.has(o.status))

    const nowIso = new Date().toISOString()
    const newOrderStatus = result === '100_percent' ? 'picker_completed_100' : 'picker_completed_short'
    let completedCount = 0
    const conflictedOrderIds: string[] = []
    for (const o of activeOrders) {
      // Guarded on the exact status just read (compare-and-swap), and done BEFORE
      // picker_completions -- same principle as submitPickerCompletion -- so a concurrent action
      // on this same order from a different terminal (an individual Pick Completion submit, an
      // Unassign) can't be silently overwritten by this bulk action, or vice versa.
      const { data: updatedOrder } = await admin
        .from('orders')
        .update({ status: newOrderStatus, picker_completed_time: nowIso })
        .eq('order_id', o.order_id)
        .eq('status', o.status)
        .select('order_id')
        .maybeSingle()
      if (!updatedOrder) {
        conflictedOrderIds.push(o.order_id)
        continue
      }
      const actualPieces = result === '100_percent' ? o.planned_pieces : null
      await admin.from('picker_completions').upsert({ order_id: o.order_id, picker_completed_time: nowIso, actual_pieces: actualPieces, result }, { onConflict: 'order_id' })
      await writeStatusHistory(admin, { entityType: 'orders', entityId: o.order_id, oldStatus: o.status, newStatus: newOrderStatus, changedBy: caller.user_id })
      completedCount++
    }

    // Same CAS guard on the batch itself -- a concurrent cancel, or this same action fired twice,
    // can't silently stomp each other's write.
    const { data: updated, error } = await admin
      .from('consolidation_batches')
      .update({ status: 'completed' })
      .eq('consol_batch_id', params.batchId)
      .eq('status', batch.status)
      .select()
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    if (!updated) {
      return NextResponse.json({ error: 'This batch was already changed by someone else — refresh and try again' }, { status: 409 })
    }

    await writeStatusHistory(admin, { entityType: 'consolidation_batches', entityId: params.batchId, oldStatus: batch.status, newStatus: 'completed', changedBy: caller.user_id })
    await writeAudit(admin, {
      userId: caller.user_id,
      action: 'consolidation_batch.complete',
      entityType: 'consolidation_batches',
      entityId: params.batchId,
      before: batch,
      after: { ...updated, result, orders_completed: completedCount, conflicted_order_ids: conflictedOrderIds.length ? conflictedOrderIds : undefined },
    })

    return NextResponse.json({ batch: updated, orders_completed: completedCount, conflicted_order_ids: conflictedOrderIds })
  }

  // action === 'cancel' -- only meaningful while the batch is still a matching candidate/review
  // that's never actually been approved as a group; an already-approved/picking batch has real
  // assignment_batches/picker work behind it and needs Consolidation Pick Report's own flow.
  if (!PENDING_BATCH_STATUSES.includes(batch.status)) {
    return NextResponse.json({ error: `Batch status is '${batch.status}' — can only cancel a batch still Pending Approval` }, { status: 409 })
  }
  const cancelled = await cancelPendingConsolidationBatch(admin, params.batchId, batch.status, caller.user_id, 'consolidation_batch.cancel', 'Cancelled by admin')
  if (!cancelled) {
    return NextResponse.json({ error: 'This batch was already changed by someone else — refresh and try again' }, { status: 409 })
  }

  const { data: updated } = await admin.from('consolidation_batches').select('*').eq('consol_batch_id', params.batchId).single()
  return NextResponse.json({ batch: updated })
}
