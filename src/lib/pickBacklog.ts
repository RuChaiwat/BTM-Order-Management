/** Pick work still open (Pick Backlog), by stage -- Operations Dashboard's "Pick backlog by order
 * date". Mirrors packBacklog.ts so both backlog tables read the same way. No server-only imports. */
export const PICK_STAGES = ['waiting', 'picking', 'verify'] as const
export type PickStage = (typeof PICK_STAGES)[number]

export const PICK_STAGE_META: Record<PickStage, { label: string; color: string }> = {
  waiting: { label: 'รอหยิบ', color: '#F59E0B' },
  picking: { label: 'กำลังหยิบ', color: '#3B82F6' },
  verify: { label: 'รอ Admin ยืนยัน', color: '#8B5CF6' },
}

/** Order status -> pick stage. Orders Admin sent back for correction count as picking again. Closed
 * and cancelled orders are not backlog (null). */
export function pickStageOf(status: string): PickStage | null {
  switch (status) {
    case 'new':
      return 'waiting'
    case 'assigned':
    case 'in_progress':
    case 'admin_rejected':
    case 'correction_in_progress':
      return 'picking'
    case 'picker_completed_100':
    case 'picker_completed_short':
    case 'waiting_admin_verification':
      return 'verify'
    default:
      return null
  }
}
