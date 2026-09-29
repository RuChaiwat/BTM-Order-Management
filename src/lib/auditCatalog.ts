import { CONFIG_FIELD_BY_KEY, toDisplayValue } from './configCatalog'

/**
 * Turns a raw audit_logs row (action string + entity_type/entity_id + before/after JSON
 * snapshots) into something a business Admin can actually read, instead of "configuration.update
 * / configuration · 32a79a66-...". Every writeAudit() call site's `action` string is cataloged
 * here (see grep -rn "action:" app/api for the full inventory) with a bilingual label; the
 * `detail` line is built from whatever before/after already recorded, occasionally enriched with
 * a friendly identifier (order_no/batch_no) looked up separately -- see getAuditTrail(), which is
 * the only place that needs a DB round trip for that.
 */

export interface AuditActionMeta {
  labelEn: string
  labelTh: string
}

export const AUDIT_ACTION_META: Record<string, AuditActionMeta> = {
  'configuration.update': { labelEn: 'Setting changed', labelTh: 'แก้ไขค่าตั้งค่า' },
  'order.cancel': { labelEn: 'Order cancelled', labelTh: 'ยกเลิกออเดอร์' },
  'picker_completion.create': { labelEn: 'Picker confirmed pick', labelTh: 'Picker ยืนยันหยิบเสร็จ' },
  'consolidation_batch.auto_complete': { labelEn: 'Batch auto-completed', labelTh: 'Batch ปิดงานอัตโนมัติ' },
  'picker.create': { labelEn: 'Picker added', labelTh: 'เพิ่มพนักงานหยิบสินค้า' },
  'picker.update': { labelEn: 'Picker updated', labelTh: 'แก้ไขข้อมูลพนักงานหยิบสินค้า' },
  'picker.delete': { labelEn: 'Picker removed', labelTh: 'ลบพนักงานหยิบสินค้า' },
  'reason_master.create': { labelEn: 'Reason code added', labelTh: 'เพิ่มรหัสเหตุผล' },
  'reason_master.update': { labelEn: 'Reason code updated', labelTh: 'แก้ไขรหัสเหตุผล' },
  'user.create': { labelEn: 'User account created', labelTh: 'สร้างบัญชีผู้ใช้งาน' },
  'user.update': { labelEn: 'User account updated', labelTh: 'แก้ไขบัญชีผู้ใช้งาน' },
  'matching.link_failed': { labelEn: 'Matching — batch link failed', labelTh: 'จับคู่ออเดอร์ — เชื่อม Batch ไม่สำเร็จ' },
  'matching.order_link_failed': { labelEn: 'Matching — some orders failed to link', labelTh: 'จับคู่ออเดอร์ — เชื่อมออเดอร์บางรายการไม่สำเร็จ' },
  'matching.run': { labelEn: 'Matching run', labelTh: 'รันการจับคู่ออเดอร์' },
  'orders.import': { labelEn: 'Orders imported', labelTh: 'นำเข้าออเดอร์' },
  'locations.create': { labelEn: 'Bin location added', labelTh: 'เพิ่มตำแหน่งจัดเก็บ' },
  'locations.activate': { labelEn: 'Bin location activated', labelTh: 'เปิดใช้งานตำแหน่งจัดเก็บ' },
  'locations.deactivate': { labelEn: 'Bin location deactivated', labelTh: 'ปิดใช้งานตำแหน่งจัดเก็บ' },
  'locations.import': { labelEn: 'Locations imported', labelTh: 'นำเข้าตำแหน่งจัดเก็บ' },
  'picker.productivity_recalc': { labelEn: 'Weekly productivity recalculated', labelTh: 'คำนวณผลิตภาพพนักงานประจำสัปดาห์' },
  'consolidation_batch.approve': { labelEn: 'Consolidation batch approved', labelTh: 'อนุมัติ Batch การรวมออเดอร์' },
  'consolidation_batch.complete': { labelEn: 'Consolidation batch completed', labelTh: 'ปิดงาน Batch การรวมออเดอร์' },
  'consolidation_batch.cancel': { labelEn: 'Consolidation batch cancelled', labelTh: 'ยกเลิก Batch การรวมออเดอร์' },
  'admin_verification.final_close': { labelEn: 'Admin verification — closed', labelTh: 'ตรวจสอบโดย Admin — ปิดงาน' },
  'admin_verification.reject': { labelEn: 'Admin verification — rejected', labelTh: 'ตรวจสอบโดย Admin — ตีกลับ' },
  'assignment.create': { labelEn: 'Work assignment created', labelTh: 'สร้างใบมอบหมายงาน' },
}

function humanizeAction(action: string): string {
  return action
    .replace(/[._]/g, ' ')
    .split(' ')
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ')
}

export function actionMeta(action: string): AuditActionMeta {
  return AUDIT_ACTION_META[action] ?? { labelEn: humanizeAction(action), labelTh: humanizeAction(action) }
}

interface RawAuditRow {
  action: string
  entity_type: string
  entity_id: string | null
  before: Record<string, unknown> | null
  after: Record<string, unknown> | null
}

/** Friendly identifiers for entity_ids that are otherwise opaque UUIDs -- order_id -> order_no,
 * consol_batch_id -> batch_no. Everything else (picker_id, reason_code, bin_code, user_id) is
 * already a human-assigned business key, so no lookup is needed for those entity types. */
export interface AuditLookups {
  orderNoById: Map<string, string>
  batchNoById: Map<string, string>
}

function asString(v: unknown): string {
  if (v === null || v === undefined) return ''
  return typeof v === 'string' ? v : JSON.stringify(v)
}

function orderRef(id: string | null, lookups: AuditLookups): string {
  if (!id) return 'order'
  const orderNo = lookups.orderNoById.get(id)
  return orderNo ? `Order ${orderNo}` : `Order ${id.slice(0, 8)}…`
}

function batchRef(id: string | null, lookups: AuditLookups): string {
  if (!id) return 'batch'
  const batchNo = lookups.batchNoById.get(id)
  return batchNo ? `Batch ${batchNo}` : `Batch ${id.slice(0, 8)}…`
}

/** One plain-English summary line per row, built entirely from what was already recorded (no
 * extra queries beyond the order_no/batch_no lookups above). Falls back to a compact dump of
 * whatever's in `after`/`before` for an action this catalog doesn't recognize yet, rather than
 * showing nothing. */
export function auditDetail(row: RawAuditRow, lookups: AuditLookups): string {
  const after = row.after ?? {}
  const before = row.before ?? {}

  switch (row.action) {
    case 'configuration.update': {
      const key = asString(after.key)
      const field = CONFIG_FIELD_BY_KEY.get(key)
      const name = field?.labelEn ?? key
      const newVal = field ? toDisplayValue(field.kind, after.value) : asString(after.value)
      const unit = field?.unit ?? ''
      const oldVal = before?.value !== undefined && field ? toDisplayValue(field.kind, before.value) : null
      return oldVal !== null && oldVal !== '' ? `${name}: ${oldVal} → ${newVal} ${unit}`.trim() : `${name}: set to ${newVal} ${unit}`.trim()
    }
    case 'order.cancel':
      return `${orderRef(row.entity_id, lookups)} — reason: ${asString(after.reason) || '—'}`
    case 'picker_completion.create':
      return `${orderRef(row.entity_id, lookups)} — ${asString(after.result)} by picker ${asString(after.picker_id)}`
    case 'consolidation_batch.auto_complete':
      return `${batchRef(row.entity_id, lookups)} closed automatically — last order confirmed via Pick Completion`
    case 'picker.create':
    case 'picker.delete':
      return `${asString((after.name_en ?? before.name_en) ?? row.entity_id)} (${row.entity_id ?? '—'})`
    case 'picker.update': {
      const activeChanged = typeof after.active === 'boolean' && after.active !== before.active
      return `${row.entity_id ?? '—'}${activeChanged ? (after.active ? ' — activated' : ' — deactivated') : ''}`
    }
    case 'reason_master.create':
    case 'reason_master.update':
      return `${row.entity_id ?? '—'}: ${asString(after.label_en) || '—'}`
    case 'user.create':
      return `${asString(after.name_en)} (${row.entity_id ?? '—'}) — ${asString(after.role)}`
    case 'user.update':
      return `${row.entity_id ?? '—'}`
    case 'matching.link_failed':
    case 'matching.order_link_failed':
      return asString(after.error) || '—'
    case 'matching.run':
      return `${asString(after.order_date)} · ${asString(after.warehouse_code)} — eligible ${asString(after.eligible)}, excluded ${asString(after.excluded_over_max_sku)}`
    case 'orders.import':
      return `created ${asString(after.orders_created)}, updated ${asString(after.orders_updated)}, lines ${asString(after.lines_upserted)}, errors ${asString(after.errors)}`
    case 'locations.create':
    case 'locations.activate':
    case 'locations.deactivate':
      return `${row.entity_id ?? '—'}`
    case 'locations.import':
      return `${asString(after.row_count)} row(s) from ${asString(after.file_name)}`
    case 'picker.productivity_recalc':
      return `${asString(after.updated)} picker(s) updated — target ${asString(after.target_pcs_per_hour)} pcs/hr`
    case 'consolidation_batch.approve':
      return `${batchRef(row.entity_id, lookups)} — assigned to picker ${asString(after.picker_id ?? after.assignment_batch_id)}`
    case 'consolidation_batch.complete':
      return `${batchRef(row.entity_id, lookups)} — ${asString(after.result)}, ${asString(after.orders_completed)} order(s)`
    case 'consolidation_batch.cancel':
      return `${batchRef(row.entity_id, lookups)}`
    case 'admin_verification.final_close':
      return `${orderRef(row.entity_id, lookups)} — ${asString(after.newStatus)}`
    case 'admin_verification.reject':
      return `${orderRef(row.entity_id, lookups)} — reason: ${asString(after.reject_reason) || '—'}`
    case 'assignment.create': {
      const orderCount = Array.isArray(after.order_ids) ? after.order_ids.length : null
      return `Zone ${asString(after.zone_code)}, picker ${asString(after.picker_id)}${orderCount !== null ? `, ${orderCount} order(s)` : ''}`
    }
    default: {
      const dump = asString(after) || asString(before)
      return dump.length > 140 ? `${dump.slice(0, 140)}…` : dump || '—'
    }
  }
}
