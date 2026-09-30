import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds } from './scopedFetch'
import { bangkokDateKey } from '../formatDate'

export interface ShortPickDetailRow {
  lineId: string
  orderId: string
  orderNo: string
  storeCode: string
  warehouseCode: string
  zoneCode: string
  sku: string
  itemDescription: string | null
  binCode: string
  reasonCode: string
  reasonLabelEn: string
  reasonLabelTh: string
  orderedQty: number
  pickedQty: number
  shortQty: number
  remark: string | null
  recordedAt: string
}

export interface ReasonKpi {
  code: string
  labelEn: string
  labelTh: string
  count: number
  shortQty: number
}

export interface ShortPickMonitorData {
  date: string
  rows: ShortPickDetailRow[]
  reasonKpis: ReasonKpi[]
  zones: string[]
}

/** reason_master's active short_pick codes -- the KPI boxes are driven by this, not a hardcoded
 * Short/Damage/Expired list, so a reason Admin adds/retires in Reason Master shows up here too
 * without a code change (same catalog ReasonMasterManager edits). */
export async function getActiveShortPickReasons(db: SupabaseClient): Promise<{ reason_code: string; label_en: string; label_th: string }[]> {
  const { data } = await db.from('reason_master').select('reason_code, label_en, label_th').eq('reason_type', 'short_pick').eq('active', true).order('label_en')
  return data ?? []
}

/**
 * Item-level short-pick detail (SKU, zone, reason, short qty) for a given set of picker
 * completions. Reason detail only exists in `picker_completion_lines`, written at Admin
 * Verification's Final Close (app/api/admin-verifications/route.ts) -- never at the picker's own
 * coarse submission (§12.2) -- so, same as Productivity's own Short Pick Reasons table, an order
 * the picker just completed but Admin hasn't verified yet won't appear here until Admin catches up.
 * `completions` is passed in (not re-queried) so every caller filters "which completions" exactly
 * once, by whatever window makes sense for it (a single day, a weekly export period, etc).
 * `warehouseCode` narrows to one warehouse (the Monitor page); omit it for a cross-warehouse caller
 * (the weekly export, which was never itself scoped to one warehouse -- see its own comment).
 */
export async function getShortPickDetailRows(
  db: SupabaseClient,
  warehouseCode: string | undefined,
  completions: { completion_id: string; order_id: string }[],
): Promise<ShortPickDetailRow[]> {
  if (completions.length === 0) return []
  const orderIdByCompletion = new Map(completions.map((c) => [c.completion_id, c.order_id]))
  const completionIds = completions.map((c) => c.completion_id)

  const { data: lines } = await db
    .from('picker_completion_lines')
    .select('line_id, completion_id, ordered_qty, picked_qty, short_reason_code, remark, created_at')
    .in('completion_id', completionIds)
    .eq('is_short', true)
  const shortLines = lines ?? []
  if (shortLines.length === 0) return []

  const lineIds = shortLines.map((l) => l.line_id)
  const { data: orderLines } = await db.from('order_lines').select('line_id, sku, item_description, bin_code, zone_code').in('line_id', lineIds)
  const orderLineByLineId = new Map((orderLines ?? []).map((ol) => [ol.line_id, ol]))

  const orderIds = [...new Set(completions.map((c) => c.order_id))]
  const { data: orders } = orderIds.length
    ? await db.from('orders').select('order_id, order_no, store_code, warehouse_code').in('order_id', orderIds)
    : { data: [] as { order_id: string; order_no: string; store_code: string; warehouse_code: string }[] }
  const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))

  const reasonCodes = [...new Set(shortLines.map((l) => l.short_reason_code).filter(Boolean))] as string[]
  const { data: reasons } = reasonCodes.length
    ? await db.from('reason_master').select('reason_code, label_en, label_th').in('reason_code', reasonCodes)
    : { data: [] as { reason_code: string; label_en: string; label_th: string }[] }
  const reasonByCode = new Map((reasons ?? []).map((r) => [r.reason_code, r]))

  const rows: ShortPickDetailRow[] = []
  for (const l of shortLines) {
    const orderId = orderIdByCompletion.get(l.completion_id)
    const order = orderId ? orderById.get(orderId) : undefined
    if (!order) continue
    if (warehouseCode && order.warehouse_code !== warehouseCode) continue
    const ol = orderLineByLineId.get(l.line_id)
    const reason = l.short_reason_code ? reasonByCode.get(l.short_reason_code) : null
    rows.push({
      lineId: l.line_id,
      orderId: order.order_id,
      orderNo: order.order_no,
      storeCode: order.store_code,
      warehouseCode: order.warehouse_code,
      zoneCode: ol?.zone_code ?? '—',
      sku: ol?.sku ?? '—',
      itemDescription: ol?.item_description ?? null,
      binCode: ol?.bin_code ?? '—',
      reasonCode: l.short_reason_code ?? 'UNSPECIFIED',
      reasonLabelEn: reason?.label_en ?? l.short_reason_code ?? 'Unspecified',
      reasonLabelTh: reason?.label_th ?? l.short_reason_code ?? 'ไม่ระบุ',
      orderedQty: Number(l.ordered_qty),
      pickedQty: Number(l.picked_qty),
      shortQty: Number(l.ordered_qty) - Number(l.picked_qty),
      remark: l.remark,
      recordedAt: l.created_at,
    })
  }
  return rows
}

/** §Item 5 (Purge review follow-up): Short/Damage/Expired Monitor -- a single (Bangkok-calendar)
 * day's short-pick detail, keyed off the picker's own confirm date exactly like Productivity's page
 * (picker_completed_time), so "which day" means the same thing across both screens. */
export async function getShortPickMonitorData(db: SupabaseClient, warehouseCode: string, date: string): Promise<ShortPickMonitorData> {
  const orders = await fetchAllRows((from, to) => db.from('orders').select('order_id').eq('warehouse_code', warehouseCode).range(from, to))
  const orderIds = orders.map((o) => o.order_id)

  const completions = await fetchScopedByOrderIds<{ completion_id: string; order_id: string; picker_completed_time: string }>(
    db,
    'get_picker_completions_by_ids',
    'completion_id, order_id, picker_completed_time',
    orderIds,
  )
  const dayCompletions = completions.filter((c) => bangkokDateKey(c.picker_completed_time) === date)

  const [rows, activeReasons] = await Promise.all([getShortPickDetailRows(db, warehouseCode, dayCompletions), getActiveShortPickReasons(db)])

  const totalsByCode = new Map<string, { count: number; shortQty: number }>()
  for (const r of rows) {
    const entry = totalsByCode.get(r.reasonCode) ?? { count: 0, shortQty: 0 }
    entry.count += 1
    entry.shortQty += r.shortQty
    totalsByCode.set(r.reasonCode, entry)
  }
  const reasonKpis: ReasonKpi[] = activeReasons.map((r) => ({
    code: r.reason_code,
    labelEn: r.label_en,
    labelTh: r.label_th,
    count: totalsByCode.get(r.reason_code)?.count ?? 0,
    shortQty: totalsByCode.get(r.reason_code)?.shortQty ?? 0,
  }))

  const zones = [...new Set(rows.map((r) => r.zoneCode))].sort()

  return { date, rows, reasonKpis, zones }
}
