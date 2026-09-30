import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit, writeStatusHistory } from './audit'

/** consolidation_batches.status values that mean "still just a matching suggestion" -- computed
 * by Matching's own run (app/api/matching/run/route.ts), which stamps every candidate order's
 * consolidation_batch_id immediately, long before anyone reviews or approves anything. Any other
 * status means the batch went through Consolidation's own Approve (approve_consolidation_batch,
 * migration 0027) and a real picker/assignment_batches group already exists for it. */
export const PENDING_BATCH_STATUSES = ['candidate', 'review']

/**
 * Cancels a consolidation batch, clearing consolidation_batch_id for every order still linked to
 * it. Order matters here: orders are cleared FIRST, batch status SECOND -- approve_consolidation_
 * batch (migration 0027) derives which orders to assign by reading `orders.consolidation_batch_id`
 * live, not this batch's own status column, so clearing the order links first is what actually
 * stops a concurrent Approve from proceeding on a batch that's being cancelled (it just sees zero
 * linked orders and fails cleanly with NO_ORDERS_IN_BATCH -- see app/api/consolidation-batches/
 * [batchId]/route.ts). Doing it in the other order would leave a real window where Approve could
 * still see the old links and succeed on a batch that's simultaneously being cancelled.
 *
 * The batch-status update itself is guarded with `.eq('status', expectedStatus)` (a compare-and-
 * swap) purely so two admins racing to cancel/re-cancel the same batch can't each write a
 * duplicate status-history/audit entry -- returns false (no-op, not an error) if something else
 * already changed the batch's status since the caller read it.
 */
export async function cancelPendingConsolidationBatch(
  admin: SupabaseClient,
  batchId: string,
  expectedStatus: string,
  changedBy: string | null,
  auditAction: 'consolidation_batch.auto_cancel' | 'consolidation_batch.cancel',
  reason: string,
): Promise<boolean> {
  await admin.from('orders').update({ consolidation_batch_id: null }).eq('consolidation_batch_id', batchId)
  const { data: updated } = await admin
    .from('consolidation_batches')
    .update({ status: 'cancelled' })
    .eq('consol_batch_id', batchId)
    .eq('status', expectedStatus)
    .select('consol_batch_id')
    .maybeSingle()
  if (!updated) return false

  await writeStatusHistory(admin, { entityType: 'consolidation_batches', entityId: batchId, oldStatus: expectedStatus, newStatus: 'cancelled', changedBy, reason })
  await writeAudit(admin, { userId: changedBy, action: auditAction, entityType: 'consolidation_batches', entityId: batchId, after: { reason } })
  return true
}

/**
 * An order that's still just a matching CANDIDATE (never approved as a Consolidation group) but
 * gets assigned individually via Work Assignment instead breaks that batch's ability to ever be
 * approved as a complete group again -- one of its members is gone. This cancels the batch and
 * clears consolidation_batch_id for every order still linked to it (not just this one), so the
 * rest fall back to being plain, individually-assignable orders instead of silently blocking a
 * later Approve (or, before this existed, wrongly blocking Pick Completion's Unassign).
 *
 * No-op if the order has no consolidation_batch_id, or its batch has already moved past
 * candidate/review (a real group assignment exists -- leave that alone, it's the case Unassign is
 * right to still block).
 */
export async function releaseFromPendingConsolidationBatch(admin: SupabaseClient, orderId: string, changedBy: string | null): Promise<void> {
  const { data: order } = await admin.from('orders').select('consolidation_batch_id').eq('order_id', orderId).maybeSingle()
  const batchId = order?.consolidation_batch_id
  if (!batchId) return

  const { data: batch } = await admin.from('consolidation_batches').select('status').eq('consol_batch_id', batchId).maybeSingle()
  if (!batch || !PENDING_BATCH_STATUSES.includes(batch.status)) return

  await cancelPendingConsolidationBatch(
    admin,
    batchId,
    batch.status,
    changedBy,
    'consolidation_batch.auto_cancel',
    `Order ${orderId} was assigned directly from Work Assignment, breaking this batch's grouping`,
  )
}
