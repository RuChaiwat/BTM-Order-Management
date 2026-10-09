/**
 * Admin-facing catalog for the `configuration` table, redesigned so a business Admin can read and
 * edit these without knowing the underlying key names or JSON shape (previous UI: a raw key/value
 * table + a free-text "value (JSON)" field). Deliberately covers ONLY the keys actually read by
 * the app (see getActiveConfig() callers across src/lib/queries and app/api) -- `configuration`
 * also holds several keys seeded per spec but never wired to any live calculation (assignment.*,
 * operational_day_cutoff, report.barcode_symbology, export.weekly_productivity_enabled/
 * drive_folder_naming, retention.active_warehouse_codes). Showing those here as editable would
 * silently do nothing when changed, which is worse than not showing them.
 *
 * order_sla.* and admin_verification.* WERE in that dead-key list too until src/lib/orderAlerts.ts
 * started reading them (previously order_alerts' own SQL view hardcoded 45/60/120 directly,
 * ignoring these seeded-but-unused rows entirely -- see migration 0031).
 *
 * retention.transaction_days WAS wrongly left out of that dead-key list in an earlier pass -- it's
 * read directly (not via getActiveConfig()) by both app/api/cron/purge and its own safety gate, so
 * it's very much live; added back here once that was caught.
 *
 * Percent fields are stored as a 0-1 decimal (matching.p2_match_pct = 0.8) but shown/edited as a
 * whole percent (80) -- toDisplay/fromDisplay below do that conversion so nothing downstream of
 * getActiveConfig() has to change.
 */

export type ConfigFieldKind = 'integer' | 'percent' | 'nullable_integer'

export interface ConfigFieldMeta {
  key: string
  category: string
  labelEn: string
  labelTh: string
  descriptionEn: string
  descriptionTh: string
  kind: ConfigFieldKind
  unit: string
  min?: number
  max?: number
  step?: number
}

export interface ConfigCategoryMeta {
  id: string
  labelEn: string
  labelTh: string
}

export const CONFIG_CATEGORIES: ConfigCategoryMeta[] = [
  { id: 'matching', labelEn: 'Order Matching', labelTh: 'การจับคู่ออเดอร์' },
  { id: 'consolidation', labelEn: 'Order Consolidation', labelTh: 'การรวมออเดอร์' },
  { id: 'order_complexity', labelEn: 'Order Complexity', labelTh: 'ความซับซ้อนของออเดอร์' },
  { id: 'order_sla', labelEn: 'Picking SLA & Alerts', labelTh: 'เกณฑ์เวลาแจ้งเตือน (ขั้น Picking)' },
  { id: 'admin_verification', labelEn: 'Verification SLA & Alerts', labelTh: 'เกณฑ์เวลาแจ้งเตือน (ขั้น Verification)' },
  { id: 'picker_productivity', labelEn: 'Picker Productivity', labelTh: 'ประสิทธิผลพนักงานหยิบสินค้า' },
  { id: 'housekeeping', labelEn: 'Data Retention', labelTh: 'ระยะเวลาเก็บข้อมูล' },
]

export const CONFIG_FIELDS: ConfigFieldMeta[] = [
  {
    key: 'matching.p1_min_pieces',
    category: 'matching',
    labelEn: 'Priority 1 — minimum pieces',
    labelTh: 'Priority 1 — จำนวนชิ้นขั้นต่ำ',
    descriptionEn: 'Orders with an identical item list are grouped automatically. This sets the minimum total pieces for that group to qualify as Priority 1 (highest priority).',
    descriptionTh: 'ออเดอร์ที่มีรายการสินค้าเหมือนกันทุกชิ้นจะถูกจัดกลุ่มอัตโนมัติ ค่านี้กำหนดจำนวนชิ้นรวมขั้นต่ำของกลุ่ม เพื่อจัดเป็น Priority 1 (สำคัญสูงสุด)',
    kind: 'integer',
    unit: 'pieces',
    min: 0,
  },
  {
    key: 'matching.p2_match_pct',
    category: 'matching',
    labelEn: 'Priority 2 — match threshold',
    labelTh: 'Priority 2 — เกณฑ์สินค้าตรงกัน',
    descriptionEn: 'Minimum percentage of shared items between orders to group them as Priority 2.',
    descriptionTh: 'เปอร์เซ็นต์ขั้นต่ำของสินค้าที่ตรงกันระหว่างออเดอร์ เพื่อจัดกลุ่มเป็น Priority 2',
    kind: 'percent',
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    key: 'matching.p2_min_pieces',
    category: 'matching',
    labelEn: 'Priority 2 — minimum pieces',
    labelTh: 'Priority 2 — จำนวนชิ้นขั้นต่ำ',
    descriptionEn: 'Minimum total pieces for a Priority 2 group to be created.',
    descriptionTh: 'จำนวนชิ้นรวมขั้นต่ำของกลุ่ม เพื่อสร้างเป็น Priority 2',
    kind: 'integer',
    unit: 'pieces',
    min: 0,
  },
  {
    key: 'matching.p3_match_pct',
    category: 'matching',
    labelEn: 'Priority 3 — match threshold',
    labelTh: 'Priority 3 — เกณฑ์สินค้าตรงกัน',
    descriptionEn: 'Minimum percentage of shared items between orders to group them as Priority 3.',
    descriptionTh: 'เปอร์เซ็นต์ขั้นต่ำของสินค้าที่ตรงกันระหว่างออเดอร์ เพื่อจัดกลุ่มเป็น Priority 3',
    kind: 'percent',
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    key: 'matching.p3_min_pieces',
    category: 'matching',
    labelEn: 'Priority 3 — minimum pieces',
    labelTh: 'Priority 3 — จำนวนชิ้นขั้นต่ำ',
    descriptionEn: 'Minimum total pieces for a Priority 3 group to be created.',
    descriptionTh: 'จำนวนชิ้นรวมขั้นต่ำของกลุ่ม เพื่อสร้างเป็น Priority 3',
    kind: 'integer',
    unit: 'pieces',
    min: 0,
  },
  {
    key: 'matching.p4_match_pct',
    category: 'matching',
    labelEn: 'Priority 4 — match threshold',
    labelTh: 'Priority 4 — เกณฑ์สินค้าตรงกัน',
    descriptionEn: 'Minimum percentage of shared items between orders to group them as Priority 4 (lowest match threshold).',
    descriptionTh: 'เปอร์เซ็นต์ขั้นต่ำของสินค้าที่ตรงกันระหว่างออเดอร์ เพื่อจัดกลุ่มเป็น Priority 4 (เกณฑ์จับคู่ต่ำสุด)',
    kind: 'percent',
    unit: '%',
    min: 0,
    max: 100,
  },
  {
    key: 'matching.p4_min_pieces',
    category: 'matching',
    labelEn: 'Priority 4 — minimum pieces',
    labelTh: 'Priority 4 — จำนวนชิ้นขั้นต่ำ',
    descriptionEn: 'Minimum total pieces for a Priority 4 group. Also used on the Matching Dashboard to flag unusually large ("oversized") orders.',
    descriptionTh: 'จำนวนชิ้นรวมขั้นต่ำของกลุ่ม Priority 4 และใช้เป็นเกณฑ์แจ้งเตือนออเดอร์ขนาดใหญ่ผิดปกติในหน้า Matching Dashboard ด้วย',
    kind: 'integer',
    unit: 'pieces',
    min: 0,
  },
  {
    key: 'consolidation.min_stores',
    category: 'consolidation',
    labelEn: 'Minimum stores per batch',
    labelTh: 'จำนวนร้านค้าขั้นต่ำต่อ Batch',
    descriptionEn: 'Minimum number of different stores that must be in a group before it can be consolidated into one batch.',
    descriptionTh: 'จำนวนร้านค้าขั้นต่ำที่ต้องอยู่ในกลุ่ม ก่อนจะรวมเป็น 1 Batch ได้',
    kind: 'integer',
    unit: 'stores',
    min: 1,
  },
  {
    key: 'consolidation.target_stores',
    category: 'consolidation',
    labelEn: 'Preferred stores per batch',
    labelTh: 'จำนวนร้านค้าที่ต้องการต่อ Batch',
    descriptionEn: 'Preferred number of stores per consolidated batch — a large group is split into batches of about this size.',
    descriptionTh: 'จำนวนร้านค้าต่อ Batch ที่ต้องการโดยประมาณ หากกลุ่มใหญ่เกินไปจะถูกแบ่งเป็นหลาย Batch ตามจำนวนนี้',
    kind: 'integer',
    unit: 'stores',
    min: 1,
  },
  {
    key: 'consolidation.max_stores',
    category: 'consolidation',
    labelEn: 'Maximum stores per batch',
    labelTh: 'จำนวนร้านค้าสูงสุดต่อ Batch',
    descriptionEn: 'Maximum number of stores allowed in a single consolidated batch.',
    descriptionTh: 'จำนวนร้านค้าสูงสุดที่อนุญาตให้อยู่ใน 1 Batch',
    kind: 'integer',
    unit: 'stores',
    min: 1,
  },
  {
    key: 'consolidation.max_orders',
    category: 'consolidation',
    labelEn: 'Maximum orders per batch',
    labelTh: 'จำนวนออเดอร์สูงสุดต่อ Batch',
    descriptionEn: 'Maximum number of orders allowed in a single consolidated batch. Leave blank for no limit.',
    descriptionTh: 'จำนวนออเดอร์สูงสุดที่อนุญาตให้อยู่ใน 1 Batch เว้นว่างไว้หากไม่ต้องการจำกัด',
    kind: 'nullable_integer',
    unit: 'orders',
    min: 1,
  },
  {
    key: 'consolidation.max_unique_sku',
    category: 'consolidation',
    labelEn: 'Maximum items per order',
    labelTh: 'จำนวนรายการสินค้าสูงสุดต่อออเดอร์',
    descriptionEn: 'Orders with more unique items (SKUs) than this are excluded from consolidation and picked individually instead.',
    descriptionTh: 'ออเดอร์ที่มีจำนวนรายการสินค้า (SKU) มากกว่าค่านี้ จะไม่ถูกนำไปรวม และจะถูกหยิบแยกเป็นออเดอร์เดี่ยวแทน',
    kind: 'integer',
    unit: 'items',
    min: 1,
  },
  {
    key: 'order_complexity.green_min_pcs_per_sku',
    category: 'order_complexity',
    labelEn: 'Simple order threshold',
    labelTh: 'เกณฑ์ออเดอร์ง่าย',
    descriptionEn: 'Orders averaging at least this many pieces per item are marked Simple (green) on the Order Pool.',
    descriptionTh: 'ออเดอร์ที่มีจำนวนชิ้นเฉลี่ยต่อรายการสินค้าอย่างน้อยเท่านี้ จะถูกจัดเป็นออเดอร์ง่าย (สีเขียว) ในหน้า Order Pool',
    kind: 'integer',
    unit: 'pcs/item',
    min: 0,
  },
  {
    key: 'order_complexity.red_max_pcs_per_sku',
    category: 'order_complexity',
    labelEn: 'Complex order threshold',
    labelTh: 'เกณฑ์ออเดอร์ซับซ้อน',
    descriptionEn: 'Orders averaging this many pieces per item or fewer are marked Complex (red) on the Order Pool.',
    descriptionTh: 'ออเดอร์ที่มีจำนวนชิ้นเฉลี่ยต่อรายการสินค้าเท่านี้หรือน้อยกว่า จะถูกจัดเป็นออเดอร์ซับซ้อน (สีแดง) ในหน้า Order Pool',
    kind: 'integer',
    unit: 'pcs/item',
    min: 0,
  },
  {
    key: 'order_sla.warning_minutes',
    category: 'order_sla',
    labelEn: 'Warning threshold',
    labelTh: 'เกณฑ์แจ้งเตือน Warning',
    descriptionEn: 'An order still being picked this long after assignment is flagged Warning on Pending Action Monitor, the Operations Dashboard, and Control Tower.',
    descriptionTh: 'ออเดอร์ที่ยังอยู่ระหว่าง Picking นานเกินเวลานี้นับจากมอบหมายงาน จะถูกตั้งค่าสถานะ Warning ในหน้า Pending Action Monitor, Operations Dashboard และ Control Tower',
    kind: 'integer',
    unit: 'min',
    min: 1,
  },
  {
    key: 'order_sla.overdue_minutes',
    category: 'order_sla',
    labelEn: 'Overdue threshold',
    labelTh: 'เกณฑ์แจ้งเตือน Overdue',
    descriptionEn: 'An order still being picked this long after assignment is flagged Overdue.',
    descriptionTh: 'ออเดอร์ที่ยังอยู่ระหว่าง Picking นานเกินเวลานี้นับจากมอบหมายงาน จะถูกตั้งค่าสถานะ Overdue',
    kind: 'integer',
    unit: 'min',
    min: 1,
  },
  {
    key: 'order_sla.critical_minutes',
    category: 'order_sla',
    labelEn: 'Critical threshold',
    labelTh: 'เกณฑ์แจ้งเตือน Critical',
    descriptionEn: 'An order still being picked this long after assignment is flagged Critical -- the highest-priority alert.',
    descriptionTh: 'ออเดอร์ที่ยังอยู่ระหว่าง Picking นานเกินเวลานี้นับจากมอบหมายงาน จะถูกตั้งค่าสถานะ Critical ซึ่งเป็นระดับแจ้งเตือนสูงสุด',
    kind: 'integer',
    unit: 'min',
    min: 1,
  },
  {
    key: 'admin_verification.warning_minutes',
    category: 'admin_verification',
    labelEn: 'Warning threshold',
    labelTh: 'เกณฑ์แจ้งเตือน Warning',
    descriptionEn: 'An order still waiting on Admin Verification this long after the picker submitted it is flagged Warning.',
    descriptionTh: 'ออเดอร์ที่รอ Admin ตรวจสอบนานเกินเวลานี้นับจาก Picker ส่งงาน จะถูกตั้งค่าสถานะ Warning',
    kind: 'integer',
    unit: 'min',
    min: 1,
  },
  {
    key: 'admin_verification.overdue_minutes',
    category: 'admin_verification',
    labelEn: 'Overdue threshold',
    labelTh: 'เกณฑ์แจ้งเตือน Overdue',
    descriptionEn: 'An order still waiting on Admin Verification this long after the picker submitted it is flagged Overdue.',
    descriptionTh: 'ออเดอร์ที่รอ Admin ตรวจสอบนานเกินเวลานี้นับจาก Picker ส่งงาน จะถูกตั้งค่าสถานะ Overdue',
    kind: 'integer',
    unit: 'min',
    min: 1,
  },
  {
    key: 'admin_verification.critical_minutes',
    category: 'admin_verification',
    labelEn: 'Critical threshold',
    labelTh: 'เกณฑ์แจ้งเตือน Critical',
    descriptionEn: 'An order still waiting on Admin Verification this long after the picker submitted it is flagged Critical -- the highest-priority alert.',
    descriptionTh: 'ออเดอร์ที่รอ Admin ตรวจสอบนานเกินเวลานี้นับจาก Picker ส่งงาน จะถูกตั้งค่าสถานะ Critical ซึ่งเป็นระดับแจ้งเตือนสูงสุด',
    kind: 'integer',
    unit: 'min',
    min: 1,
  },
  {
    key: 'picker_productivity.target_pcs_per_hour',
    category: 'picker_productivity',
    labelEn: 'Target picking speed',
    labelTh: 'เป้าหมายความเร็วในการหยิบ',
    descriptionEn: 'Target picking speed used to rate picker productivity (Picker Management) and to rank Top/Bottom pickers on the Productivity page.',
    descriptionTh: 'เป้าหมายความเร็วในการหยิบสินค้า ใช้ให้คะแนนประสิทธิผลพนักงาน (หน้าจัดการพนักงานหยิบสินค้า) และจัดอันดับ Top/Bottom Pickers ในหน้า Productivity',
    kind: 'integer',
    unit: 'pcs/hr',
    min: 0,
    step: 50,
  },
  {
    key: 'retention.transaction_days',
    category: 'housekeeping',
    labelEn: 'Data retention window',
    labelTh: 'ระยะเวลาเก็บข้อมูล',
    descriptionEn:
      'Closed/cancelled orders older than this many days (and everything recorded against them) can be permanently purged — only after a weekly export has already covered that period (Housekeeping, below).',
    descriptionTh: 'ออเดอร์ที่ปิดงาน/ยกเลิกแล้ว ซึ่งเก่ากว่าจำนวนวันนี้ (และข้อมูลที่บันทึกไว้กับออเดอร์นั้น) จะถูกลบถาวรได้ — ก็ต่อเมื่อมี Weekly Export ที่ครอบคลุมช่วงเวลานั้นแล้วเท่านั้น (ดู Housekeeping ด้านล่าง)',
    kind: 'integer',
    unit: 'days',
    min: 1,
  },
]

export const CONFIG_FIELD_BY_KEY = new Map(CONFIG_FIELDS.map((f) => [f.key, f]))

/** Raw stored value -> what the input box shows. */
export function toDisplayValue(kind: ConfigFieldKind, raw: unknown): string {
  if (raw === null || raw === undefined) return ''
  const n = Number(raw)
  if (Number.isNaN(n)) return ''
  return kind === 'percent' ? String(Math.round(n * 1000) / 10) : String(n)
}

/** What the input box shows -> the value sent back to the API (nullable_integer allows blank). */
export function fromDisplayValue(kind: ConfigFieldKind, display: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = display.trim()
  if (trimmed === '') {
    return kind === 'nullable_integer' ? { ok: true, value: null } : { ok: false }
  }
  const n = Number(trimmed)
  if (Number.isNaN(n)) return { ok: false }
  return { ok: true, value: kind === 'percent' ? Math.round((n / 100) * 10000) / 10000 : Math.round(n) }
}
