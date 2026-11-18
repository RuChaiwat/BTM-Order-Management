/** Pack work still open (Pack Backlog), in the order the Packing Dashboard shows it. Shared by
 * the dashboard, the backlog list page and its export, so it has no server-only imports. */
export const BACKLOG_STATUSES = ['pending', 'packing', 'packed', 'issue'] as const
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number]

export const BACKLOG_META: Record<BacklogStatus, { label: string; color: string }> = {
  pending: { label: 'รอแพ็ก', color: '#F59E0B' },
  packing: { label: 'กำลังแพ็ก', color: '#3B82F6' },
  packed: { label: 'แพ็กเสร็จ รอยืนยัน', color: '#8B5CF6' },
  issue: { label: 'มีปัญหา', color: '#DC2626' },
}

export const isBacklogStatus = (v: unknown): v is BacklogStatus => typeof v === 'string' && (BACKLOG_STATUSES as readonly string[]).includes(v)
