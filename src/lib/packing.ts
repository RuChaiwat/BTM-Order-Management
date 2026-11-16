import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './queries/config'
import { PACKING_LONG_SESSION_DEFAULT, PACKING_LONG_SESSION_KEY, PACKING_MIN_DURATION_DEFAULT, PACKING_MIN_DURATION_KEY, PACKING_RED_DEFAULT, PACKING_RED_KEY, PACKING_TARGET_DEFAULT, PACKING_TARGET_KEY } from './configCatalog'
import { bangkokDateKey, bangkokDayRange } from './formatDate'
import { writeAudit, writeStatusHistory } from './audit'

/** orders.pack_status values (migration 0035). NULL = the order never entered packing. */
export type PackStatus = 'pending' | 'packing' | 'packed' | 'issue' | 'confirmed'

export const PACK_STATUS_LABEL: Record<PackStatus, { en: string; th: string }> = {
  pending: { en: 'Waiting to pack', th: 'รอแพ็ก' },
  packing: { en: 'Packing', th: 'กำลังแพ็ก' },
  packed: { en: 'Packed — awaiting confirm', th: 'แพ็กเสร็จ รอยืนยัน' },
  issue: { en: 'Issue reported', th: 'มีปัญหา รอตรวจสอบ' },
  confirmed: { en: 'Pack confirmed', th: 'ยืนยันแพ็กแล้ว' },
}

/** Configuration > Packing > minimum packing time, in minutes (default 5, clamped 0-120). */
export async function getPackMinDurationMinutes(db: SupabaseClient): Promise<number> {
  const raw = Number((await getActiveConfig(db, [PACKING_MIN_DURATION_KEY])).value(PACKING_MIN_DURATION_KEY))
  return Number.isFinite(raw) && raw >= 0 ? Math.min(120, Math.round(raw)) : PACKING_MIN_DURATION_DEFAULT
}

import type { PackTimeBands } from './packTimeBand'
export { packTimeBand, type PackTimeBand, type PackTimeBands } from './packTimeBand'

/** Packing settings: the green/yellow/red time bands and the target pcs/hr. */
export async function getPackingSettings(db: SupabaseClient): Promise<PackTimeBands & { targetPcsPerHour: number }> {
  const cfg = await getActiveConfig(db, [PACKING_LONG_SESSION_KEY, PACKING_RED_KEY, PACKING_TARGET_KEY])
  const num = (key: string) => {
    const raw = cfg.value(key)
    const n = Number(raw)
    return raw === undefined || raw === null || raw === '' || !Number.isFinite(n) ? null : n
  }
  const yellow = num(PACKING_LONG_SESSION_KEY)
  const red = num(PACKING_RED_KEY)
  const target = num(PACKING_TARGET_KEY)
  const yellowMinutes = yellow !== null && yellow > 0 ? Math.round(yellow) : PACKING_LONG_SESSION_DEFAULT
  let redMinutes = red !== null && red > 0 ? Math.round(red) : PACKING_RED_DEFAULT
  if (redMinutes <= yellowMinutes) redMinutes = yellowMinutes + 1 // never overlapping bands
  return { yellowMinutes, redMinutes, targetPcsPerHour: target !== null && target >= 0 ? Math.round(target) : PACKING_TARGET_DEFAULT }
}

/**
 * No packing carries over to the next day (client rule): every pack session still open that
 * started before today (Bangkok) is cancelled -- never counted in productivity -- and its order
 * goes back to waiting to pack. Run by the daily cron just after midnight and, as a safety net
 * for the cron's loose timing, whenever Live Packing Monitor loads or a packer scans an order.
 * Returns how many sessions were cancelled.
 */
export async function cancelStalePackSessions(db: SupabaseClient): Promise<number> {
  const { sinceIso: todayStart } = bangkokDayRange(bangkokDateKey(new Date())!)
  const { data: stale } = await db.from('pack_sessions').select('session_id').is('finished_at', null).lt('started_at', todayStart).limit(500)
  if (!stale || stale.length === 0) return 0
  const reason = 'ระบบยกเลิกอัตโนมัติ: ค้างข้ามวัน · Auto-cancelled, carried over to a new day'
  let n = 0
  for (const { session_id } of stale) {
    const { data: s } = await db
      .from('pack_sessions')
      .update({ finished_at: new Date().toISOString(), result: 'cancelled', cancelled_by: null, cancel_reason: reason })
      .eq('session_id', session_id)
      .is('finished_at', null)
      .select('session_id, order_id, picker_id, station_code, started_at')
      .maybeSingle()
    if (!s) continue // finished or cancelled meanwhile
    n++
    await db.from('orders').update({ pack_status: 'pending' }).eq('order_id', s.order_id).eq('pack_status', 'packing')
    await writeStatusHistory(db, { entityType: 'order_pack', entityId: s.order_id, oldStatus: 'packing', newStatus: 'pending', changedBy: null, reason })
    await writeAudit(db, { userId: null, action: 'pack.auto_cancel_session', entityType: 'orders', entityId: s.order_id, after: { ...s, reason } })
  }
  return n
}

/** Pieces a finished pack session earns for productivity: the order's pieces minus the pieces the
 * packer reported as a problem (แจ้งปัญหา) and minus the pieces Admin Pack Verify recorded as short
 * (client rules), never below 0. When Admin closed a reported problem himself, the reported items
 * are usually the ones verify records as short, so only the larger of the two comes off. */
export function creditedPieces(s: { pieces: number; issue_pieces: number; short_pieces?: number | null; result?: string | null }) {
  const issue = Number(s.issue_pieces)
  const short = Number(s.short_pieces ?? 0)
  return Math.max(0, Number(s.pieces) - (s.result === 'issue_closed' ? Math.max(issue, short) : issue + short))
}

/** Session results that count toward packing productivity (migration 0039). 'issue' = paused,
 * waiting for Admin; 'issue_returned' = its time went into the next session of the order. */
export const CREDITED_RESULTS = ['completed', 'completed_short', 'issue_closed']
/** Session results where the packer reported a problem. */
export const ISSUE_RESULTS = new Set(['issue', 'issue_closed', 'issue_returned'])

/** Working seconds of a finished session, including the time carried over from a paused attempt. */
export function sessionSeconds(s: { started_at: string; finished_at: string | null; carried_seconds?: number | null }) {
  if (!s.finished_at) return 0
  return Math.max(0, (new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000) + Number(s.carried_seconds ?? 0)
}

/**
 * Timer a new pack session of this order starts from (client rule): when the order's last attempt
 * reported a problem that Admin sent back to pack, the clock continues where it stopped -- the
 * paused time never counts. A cancelled attempt in between passes that carry along unchanged.
 */
export async function packCarryFor(db: SupabaseClient, orderId: string): Promise<{ carriedSeconds: number; resumedFrom: string | null }> {
  const { data: last } = await db
    .from('pack_sessions')
    .select('session_id, started_at, finished_at, result, carried_seconds, resumed_from')
    .eq('order_id', orderId)
    .not('finished_at', 'is', null)
    .order('finished_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (last?.result === 'issue_returned') return { carriedSeconds: Math.round(sessionSeconds(last)), resumedFrom: last.session_id }
  if (last?.result === 'cancelled' && last.resumed_from) return { carriedSeconds: Number(last.carried_seconds ?? 0), resumedFrom: last.resumed_from }
  return { carriedSeconds: 0, resumedFrom: null }
}

/** What the paused attempt reported and what Admin found -- shown on the Handheld when the order
 * is scanned again, so whoever continues knows what to look at. */
export async function previousPackIssue(db: SupabaseClient, pausedSessionId: string | null) {
  if (!pausedSessionId) return null
  const { data: issue } = await db.from('pack_issues').select('issue_id, root_cause, resolution_note').eq('session_id', pausedSessionId).limit(1).maybeSingle()
  if (!issue) return null
  const [{ data: lines }, { data: reasons }] = await Promise.all([
    db.from('pack_issue_lines').select('barcode, sku, item_description, reason_code, qty').eq('issue_id', issue.issue_id),
    db.from('pack_issue_reasons').select('reason_code, label_en, label_th'),
  ])
  const label = new Map((reasons ?? []).map((r) => [r.reason_code, r.label_th || r.label_en]))
  return {
    root_cause: PACK_ROOT_CAUSES.find((r) => r.code === issue.root_cause)?.th ?? issue.root_cause ?? null,
    note: issue.resolution_note ?? null,
    lines: (lines ?? []).map((l) => ({ barcode: l.barcode || l.sku, description: l.item_description, reason: label.get(l.reason_code) ?? l.reason_code, qty: Number(l.qty) })),
  }
}

/** Problems that put extra stock in the box: the extra pieces were never in the order's pieces, so
 * they take nothing off the packer's productivity (client rule). */
export const PACK_EXTRA_REASONS = new Set(['OVER', 'NOT_IN_TO'])

/** Pieces of a reported problem that come off the packer's productivity: for each TO line, the
 * reported qty capped at that line's verified qty (V); สินค้าเกิน / สินค้าไม่มีใน TO take nothing. */
export function issueDeductPieces(lines: { line_id: string | null; reason_code: string; qty: number }[], verifiedQtyByLine: Map<string, number>) {
  let total = 0
  for (const l of lines) {
    if (!l.line_id || PACK_EXTRA_REASONS.has(l.reason_code)) continue
    total += Math.min(Number(l.qty), verifiedQtyByLine.get(l.line_id) ?? 0)
  }
  return Math.max(0, Math.round(total))
}

/** Root causes the Pack Supervisor records when closing a pack issue. */
export const PACK_ROOT_CAUSES: { code: string; th: string; en: string }[] = [
  { code: 'PICK_ERROR', th: 'Pick ผิด', en: 'Picking error' },
  { code: 'VERIFY_ERROR', th: 'Verify ผิด', en: 'Verification error' },
  { code: 'PRODUCT_DEFECT', th: 'สินค้าเสีย / หมดอายุจากต้นทาง', en: 'Product defect at source' },
  { code: 'WMS_DATA', th: 'ข้อมูล WMS ผิด', en: 'WMS data error' },
  { code: 'PACKER_ERROR', th: 'Packer ผิด', en: 'Packer error' },
  { code: 'NOT_ISSUE', th: 'ไม่ใช่ปัญหา', en: 'Not an issue' },
]

export interface PackOrderLine {
  line_id: string
  sku: string
  sku_barcode: string | null
  item_description: string | null
  bin_code: string
  /** verified picked qty (V) */
  qty: number
  /** ordered qty (O) */
  ordered_qty: number
}

/** Lines of an order as they should be packed: the quantity is Admin Verification's verified
 * picked quantity (picker_completion_lines) when there is one, so a short-closed order shows what
 * was actually picked, not what was ordered. Lines verified at 0 picked are left out unless
 * includeZero (the handheld shows them as O/0 so a packer can still report them). */
export async function getPackOrderLines(db: SupabaseClient, orderId: string, opts: { includeZero?: boolean } = {}): Promise<{ lines: PackOrderLine[]; pieces: number }> {
  const [{ data: lines }, { data: completion }] = await Promise.all([
    db.from('order_lines').select('line_id, sku, sku_barcode, item_description, bin_code, qty').eq('order_id', orderId).order('sku'),
    db.from('picker_completions').select('completion_id, actual_pieces').eq('order_id', orderId).maybeSingle(),
  ])
  const pickedByLine = new Map<string, number>()
  if (completion) {
    const { data: cl } = await db.from('picker_completion_lines').select('line_id, picked_qty').eq('completion_id', completion.completion_id)
    for (const l of cl ?? []) pickedByLine.set(l.line_id, Number(l.picked_qty))
  }
  const out = (lines ?? [])
    .map((l) => ({ ...l, qty: pickedByLine.get(l.line_id) ?? Number(l.qty), ordered_qty: Number(l.qty) }))
    .filter((l) => opts.includeZero || l.qty > 0)
  const pieces = completion?.actual_pieces ?? out.reduce((s, l) => s + l.qty, 0)
  return { lines: out, pieces: Number(pieces) }
}
