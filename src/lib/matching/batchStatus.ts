/**
 * Consolidation batch status → display label / badge tone / printability, shared by every screen
 * that shows a batch's status (Matching Analysis & Batch Review, Matching Dashboard, Consolidation
 * Pick Report, Consolidation History, the A4 pick report itself).
 *
 * The lifecycle only has one user-facing decision point now: Approve (which used to be two steps,
 * "Approve" then "Release", collapsed into one — see app/api/consolidation-batches/[batchId]/route.ts).
 * Approving a batch sets its status straight to `report_released`, so that's the status this map
 * labels "Approved". `approved` is kept in the label map only because it's still a legal enum value
 * for any batch that reached it before this change; new batches never stop there.
 */
export const BATCH_STATUS_LABELS: Record<string, string> = {
  candidate: 'Pending Approval',
  review: 'Pending Approval',
  approved: 'Approved',
  report_released: 'Approved',
  picking: 'Picking',
  at_consolidation: 'At Consolidation',
  sorting: 'Sorting',
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export const BATCH_STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  candidate: 'neutral',
  review: 'neutral',
  approved: 'success',
  report_released: 'success',
  picking: 'info',
  at_consolidation: 'info',
  sorting: 'info',
  completed: 'success',
  cancelled: 'danger',
}

/** A batch can be viewed at any status, but only printed once it has been approved (or moved
 * further along the pipeline past that point). */
export const PRINTABLE_BATCH_STATUSES = new Set(['approved', 'report_released', 'picking', 'at_consolidation', 'sorting', 'completed'])

export function batchStatusLabel(status: string): string {
  return BATCH_STATUS_LABELS[status] ?? status
}

export function batchStatusTone(status: string): 'neutral' | 'info' | 'success' | 'danger' | 'warning' {
  return BATCH_STATUS_TONE[status] ?? 'neutral'
}

export function isBatchPrintable(status: string): boolean {
  return PRINTABLE_BATCH_STATUSES.has(status)
}
