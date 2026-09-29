import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit, writeStatusHistory } from './audit'

export type SubmitPickerCompletionResult = { ok: true; status: string } | { ok: false; httpStatus: number; error: string }

/**
 * Shared by the office-authenticated route (app/api/picker-completions) and the public,
 * unauthenticated Handheld route (app/api/handheld/picker-completions) -- both submit the exact
 * same action, the only difference is whether there's a logged-in office user to credit as
 * `changedBy` (a Picker's own Handheld has none, since Pickers have no login of their own --
 * migration 0015). Kept as one function so the business rules (order must still be active, must
 * actually belong to that picker, the consolidation-batch auto-complete cascade) can't drift
 * between the two entry points.
 *
 * Pick Completion redesign: the picker only reports a coarse result -- Completed (100%) or
 * Completed with Short -- no per-line quantity or reason. Admin Verification is where the real
 * short quantity/reason gets entered, against the actual WMS confirmation. Confirming here stops
 * the order's clock (picker_completed_time) and moves it into the Admin Verification queue.
 */
export async function submitPickerCompletion(
  admin: SupabaseClient,
  { orderId, pickerId, result, changedBy }: { orderId: string; pickerId: string; result: '100_percent' | 'short'; changedBy: string | null },
): Promise<SubmitPickerCompletionResult> {
  const { data: order } = await admin.from('orders').select('order_id, status, planned_pieces, assignment_batch_id, consolidation_batch_id').eq('order_id', orderId).single()
  if (!order) return { ok: false, httpStatus: 404, error: 'Order not found' }
  if (!['assigned', 'in_progress', 'correction_in_progress'].includes(order.status)) {
    return { ok: false, httpStatus: 409, error: `Order status is '${order.status}' — must be Assigned, In Progress, or returned for correction to complete` }
  }

  const { data: batch } = await admin.from('assignment_batches').select('picker_id').eq('assignment_batch_id', order.assignment_batch_id ?? '').maybeSingle()
  if (!batch || batch.picker_id !== pickerId) {
    return { ok: false, httpStatus: 409, error: 'This order is not assigned to that picker' }
  }

  // actual_pieces is only really known for a full pick -- for a short completion, the real count
  // isn't known until Admin checks the WMS and enters it during verification (nullable since
  // migration 0021).
  const actualPieces = result === '100_percent' ? order.planned_pieces : null
  const nowIso = new Date().toISOString()
  const { error: completionError } = await admin
    .from('picker_completions')
    .upsert({ order_id: orderId, picker_completed_time: nowIso, actual_pieces: actualPieces, result }, { onConflict: 'order_id' })
  if (completionError) return { ok: false, httpStatus: 400, error: completionError.message }

  const newStatus = result === '100_percent' ? 'picker_completed_100' : 'picker_completed_short'
  await admin.from('orders').update({ status: newStatus, picker_completed_time: nowIso }).eq('order_id', orderId)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: orderId, oldStatus: order.status, newStatus, changedBy })
  await writeAudit(admin, { userId: changedBy, action: 'picker_completion.create', entityType: 'orders', entityId: orderId, after: { result, picker_id: pickerId } })

  // This order may have come from a Consolidation Batch (migration 0027's Approve, or a mixed
  // batch closed out per-order here instead of via Consolidation Pick Report's own "Mark
  // completed" -- see that page's own note about mixed 100%/short batches). If it was the LAST
  // order in that batch still being actively picked, auto-close the batch too -- otherwise it
  // would sit in Consolidation Pick Report's active worklist forever even though every order
  // inside it is actually done, with no one reminded to close it out themselves.
  if (order.consolidation_batch_id) {
    const { count: stillActive } = await admin
      .from('orders')
      .select('order_id', { count: 'exact', head: true })
      .eq('consolidation_batch_id', order.consolidation_batch_id)
      .in('status', ['assigned', 'in_progress', 'correction_in_progress'])
    if ((stillActive ?? 0) === 0) {
      const { data: consolBatch } = await admin.from('consolidation_batches').select('status').eq('consol_batch_id', order.consolidation_batch_id).maybeSingle()
      if (consolBatch && !['completed', 'cancelled'].includes(consolBatch.status)) {
        await admin.from('consolidation_batches').update({ status: 'completed' }).eq('consol_batch_id', order.consolidation_batch_id)
        await writeStatusHistory(admin, {
          entityType: 'consolidation_batches',
          entityId: order.consolidation_batch_id,
          oldStatus: consolBatch.status,
          newStatus: 'completed',
          changedBy,
        })
        await writeAudit(admin, {
          userId: changedBy,
          action: 'consolidation_batch.auto_complete',
          entityType: 'consolidation_batches',
          entityId: order.consolidation_batch_id,
          after: { triggered_by_order_id: orderId },
        })
      }
    }
  }

  return { ok: true, status: newStatus }
}
