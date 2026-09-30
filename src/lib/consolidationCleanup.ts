import type { SupabaseClient } from '@supabase/supabase-js'
import { writeAudit, writeStatusHistory } from './audit'

/** consolidation_batches.status values that mean "still just a matching suggestion" -- computed
 * by Matching's own run (app/api/matching/run/route.ts), which stamps every candidate order's
 * consolidation_batch_id immediately, long before anyone reviews or approves anything. Any other
 * status means the batch went through Consolidation's own Approve (approve_consolidation_batch,
 * migration 0027) and a real picker/assignment_batches group already exists for it. */
const PENDING_BATCH_STATUSES = ['candidate', 'review']

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

  await admin.from('orders').update({ consolidation_batch_id: null }).eq('consolidation_batch_id', batchId)
  await admin.from('consolidation_batches').update({ status: 'cancelled' }).eq('consol_batch_id', batchId)
  await writeStatusHistory(admin, {
    entityType: 'consolidation_batches',
    entityId: batchId,
    oldStatus: batch.status,
    newStatus: 'cancelled',
    changedBy,
    reason: `Order ${orderId} was assigned directly from Work Assignment, breaking this batch's grouping`,
  })
  await writeAudit(admin, {
    userId: changedBy,
    action: 'consolidation_batch.auto_cancel',
    entityType: 'consolidation_batches',
    entityId: batchId,
    after: { triggered_by_order_id: orderId },
  })
}
