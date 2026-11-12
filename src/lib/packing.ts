import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './queries/config'
import { PACKING_LONG_SESSION_DEFAULT, PACKING_LONG_SESSION_KEY, PACKING_MIN_DURATION_DEFAULT, PACKING_MIN_DURATION_KEY, PACKING_TARGET_DEFAULT, PACKING_TARGET_KEY } from './configCatalog'

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

/** The other two Packing settings: long-running threshold (minutes) and target pcs/hr. */
export async function getPackingSettings(db: SupabaseClient) {
  const cfg = await getActiveConfig(db, [PACKING_LONG_SESSION_KEY, PACKING_TARGET_KEY])
  const long = Number(cfg.value(PACKING_LONG_SESSION_KEY))
  const target = Number(cfg.value(PACKING_TARGET_KEY))
  return {
    longSessionMinutes: Number.isFinite(long) && long > 0 ? Math.round(long) : PACKING_LONG_SESSION_DEFAULT,
    targetPcsPerHour: Number.isFinite(target) && target >= 0 ? Math.round(target) : PACKING_TARGET_DEFAULT,
  }
}

/** Pieces a finished pack session earns for productivity: the order's pieces minus the pieces the
 * packer reported as a problem (แจ้งปัญหา) and minus the pieces Admin Pack Verify recorded as short
 * (client rules), never below 0. */
export function creditedPieces(s: { pieces: number; issue_pieces: number; short_pieces?: number | null }) {
  return Math.max(0, Number(s.pieces) - Number(s.issue_pieces) - Number(s.short_pieces ?? 0))
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
