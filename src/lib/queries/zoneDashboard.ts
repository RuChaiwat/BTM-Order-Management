import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds } from './scopedFetch'

// Same reality as dashboard.ts: this app never actually sets an order or assignment_batch to
// 'in_progress' (no "picker started scanning" event exists) -- every live order/batch just sits
// at 'assigned' until the picker submits a completion. Anything meaning "still being worked"
// checks all three of these instead of trusting 'in_progress' alone.
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])
const TERMINAL_CLOSED_STATUSES = new Set(['final_closed_100', 'final_closed_short'])
// "Picking done" for Pending Pieces -- see dashboard.ts's PICKING_DONE_STATUSES for the full
// reasoning: once the picker submits, the physical picking work is done even before Admin verifies.
const PICKING_DONE_STATUSES = new Set(['picker_completed_100', 'picker_completed_short', 'final_closed_100', 'final_closed_short'])

export interface ZoneActiveOrderRow {
  orderId: string
  orderNo: string
  status: string
  pickerName: string
  elapsedMinutes: number
  timeAlert: string | null
}

export interface ZoneShortPickRow {
  orderId: string
  orderNo: string
  sku: string
  pickerName: string
  orderedQty: number
  shortQty: number
  reason: string
}

/** §12/§13 Zone Dashboard — a zone-level drill-down of Control Tower's zone overview: which
 * orders touch each zone, who is actively picking there, and each zone's backlog/SLA. */
export async function getZoneDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [lines, orders, batches, zones] = await Promise.all([
    fetchAllRows((from, to) => db.from('order_lines').select('order_id, line_id, sku, zone_code').eq('warehouse_code', warehouseCode).range(from, to)),
    fetchAllRows((from, to) => db.from('orders').select('order_id, order_no, status, assignment_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).range(from, to)),
    fetchAllRows((from, to) => db.from('assignment_batches').select('assignment_batch_id, picker_id, zone_code, status').eq('warehouse_code', warehouseCode).range(from, to)),
    getActiveZoneCodes(db, warehouseCode),
  ])

  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const pickerIdByBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))

  // order_alerts/picker_completions have no warehouse_code column, so both are fetched via an RPC
  // scoped to exactly this warehouse's order_ids (migration 0022) instead of the whole table.
  // picker_completion_lines has neither warehouse_code nor order_id, only completion_id -- fetched
  // whole (its own row count is bounded by how many lines were ever short-picked, not by total
  // order volume) and matched back to an order via completionById below, which is itself already
  // scoped to this warehouse.
  const orderIds = orders.map((o) => o.order_id)
  const [alerts, completions, allShortLines, reasonRows] = await Promise.all([
    fetchScopedByOrderIds<{ order_id: string; time_alert: string | null; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }>(
      db,
      'get_order_alerts_by_ids',
      'order_id, time_alert, elapsed_minutes, is_picking_backlog, is_verification_backlog',
      orderIds,
    ),
    fetchScopedByOrderIds<{ completion_id: string; order_id: string; actual_pieces: number | null }>(db, 'get_picker_completions_by_ids', 'completion_id, order_id, actual_pieces', orderIds),
    fetchAllRows((from, to) => db.from('picker_completion_lines').select('completion_id, line_id, ordered_qty, picked_qty, short_reason_code').eq('is_short', true).range(from, to)),
    db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick'),
  ])
  const alertByOrder = new Map(alerts.map((a) => [a.order_id, a]))
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))
  const completionById = new Map(completions.map((c) => [c.completion_id, c]))
  const lineById = new Map(lines.map((l) => [l.line_id, l]))
  const reasonLabelByCode = new Map(unwrap(reasonRows).map((r) => [r.reason_code, r.label_en]))

  const pickerIds = [...new Set(batches.map((b) => b.picker_id).filter(Boolean))] as string[]
  const pickersRes = pickerIds.length ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds) : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))
  const pickerNameForOrder = (o: (typeof orders)[number]) => {
    const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
    return pickerId ? nameByPicker.get(pickerId) ?? pickerId : '—'
  }

  const zoneOrderIds = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrderIds.has(l.zone_code)) zoneOrderIds.set(l.zone_code, new Set())
    zoneOrderIds.get(l.zone_code)!.add(l.order_id)
  }

  // Short-pick line detail, warehouse-wide, attributed to the SPECIFIC zone the short line's own
  // bin is in (not "any zone the order touches") -- a short pick happens at one bin, so it belongs
  // to that bin's zone.
  const shortPickRowsByZone = new Map<string, ZoneShortPickRow[]>()
  for (const sl of allShortLines) {
    const completion = completionById.get(sl.completion_id)
    if (!completion) continue
    const order = orderById.get(completion.order_id)
    if (!order) continue // not this warehouse
    const line = lineById.get(sl.line_id)
    if (!line?.zone_code) continue
    const row: ZoneShortPickRow = {
      orderId: order.order_id,
      orderNo: order.order_no,
      sku: line.sku,
      pickerName: pickerNameForOrder(order),
      orderedQty: sl.ordered_qty,
      shortQty: Math.max(0, sl.ordered_qty - sl.picked_qty),
      reason: sl.short_reason_code ? reasonLabelByCode.get(sl.short_reason_code) ?? sl.short_reason_code : '—',
    }
    if (!shortPickRowsByZone.has(line.zone_code)) shortPickRowsByZone.set(line.zone_code, [])
    shortPickRowsByZone.get(line.zone_code)!.push(row)
  }

  // Which zone an ACTIVE order is really being worked in -- the assignment batch's own zone_code,
  // not "any zone one of its lines touches" (an order can touch multiple zones, but FR-030 confines
  // it to being actively picked as part of ONE batch, in ONE zone). Using the broader line-based
  // set for both the Orders list AND Active Pickers previously let an order with a named Picker and
  // an Assigned status show up in a zone's order list while never counting toward that same zone's
  // Active Pickers, because the two used different definitions of "this zone" for the same order --
  // a real, confusing inconsistency. Both are now derived from this one map, so they can't disagree.
  const zoneOfBatch = new Map(batches.filter((b) => b.zone_code).map((b) => [b.assignment_batch_id, b.zone_code as string]))
  const activeOrdersByZone = new Map<string, ZoneActiveOrderRow[]>()
  const zonePickerWork = new Map<string, Map<string, { orders: number; pieces: number }>>()
  for (const o of orders) {
    if (!o.assignment_batch_id || !ACTIVE_ORDER_STATUSES.has(o.status)) continue
    const zone = zoneOfBatch.get(o.assignment_batch_id)
    const pickerId = pickerIdByBatch.get(o.assignment_batch_id)
    if (!zone || !pickerId) continue

    if (!zonePickerWork.has(zone)) zonePickerWork.set(zone, new Map())
    const perPicker = zonePickerWork.get(zone)!
    const entry = perPicker.get(pickerId) ?? { orders: 0, pieces: 0 }
    entry.orders += 1
    entry.pieces += o.planned_pieces ?? 0
    perPicker.set(pickerId, entry)

    const alert = alertByOrder.get(o.order_id)
    if (!activeOrdersByZone.has(zone)) activeOrdersByZone.set(zone, [])
    activeOrdersByZone.get(zone)!.push({
      orderId: o.order_id,
      orderNo: o.order_no,
      status: o.status,
      pickerName: nameByPicker.get(pickerId) ?? pickerId,
      elapsedMinutes: Math.round(alert?.elapsed_minutes ?? 0),
      timeAlert: alert?.time_alert ?? null,
    })
  }

  const zoneDetail = zones.map((zone) => {
    const touching = [...(zoneOrderIds.get(zone) ?? new Set())]
      .map((id) => orderById.get(id))
      .filter((o): o is NonNullable<typeof o> => Boolean(o))

    const closed = touching.filter((o) => TERMINAL_CLOSED_STATUSES.has(o.status ?? ''))
    const pickingDone = touching.filter((o) => PICKING_DONE_STATUSES.has(o.status ?? ''))
    const totalPieces = touching.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
    // Drops once the picker submits, not only once Admin verifies -- see dashboard.ts.
    const pendingPieces = totalPieces - pickingDone.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
    const slaPct = touching.length > 0 ? Math.round((closed.length / touching.length) * 1000) / 10 : 100

    const activeOrders = (activeOrdersByZone.get(zone) ?? []).sort((a, b) => b.elapsedMinutes - a.elapsedMinutes)
    const criticalCount = activeOrders.filter((o) => o.timeAlert === 'critical').length
    const overdueCount = activeOrders.filter((o) => o.timeAlert === 'overdue').length
    const riskLevel: 'red' | 'yellow' | 'green' = criticalCount > 0 ? 'red' : overdueCount > 0 ? 'yellow' : 'green'

    const pickerWork = zonePickerWork.get(zone)
    const activePickerTotalPieces = pickerWork ? [...pickerWork.values()].reduce((s, w) => s + w.pieces, 0) : 0
    const activePickerTotalOrders = pickerWork ? [...pickerWork.values()].reduce((s, w) => s + w.orders, 0) : 0

    const shortPickRows = (shortPickRowsByZone.get(zone) ?? []).sort((a, b) => b.shortQty - a.shortQty)
    const qtyShortPieces = shortPickRows.reduce((s, r) => s + r.shortQty, 0)
    const qtyShortOrders = new Set(shortPickRows.map((r) => r.orderId)).size

    return {
      zone,
      activeOrders,
      shortPickRows,
      activePickers: pickerWork?.size ?? 0,
      activePickerTotalPieces,
      activePickerTotalOrders,
      pickingBacklog: touching.filter((o) => alertByOrder.get(o.order_id)?.is_picking_backlog).length,
      verificationBacklog: touching.filter((o) => alertByOrder.get(o.order_id)?.is_verification_backlog).length,
      verificationBacklogPieces: touching
        .filter((o) => alertByOrder.get(o.order_id)?.is_verification_backlog)
        .reduce((s, o) => s + (completionByOrderId.get(o.order_id)?.actual_pieces ?? 0), 0),
      qtyShortPieces,
      qtyShortOrders,
      totalPieces,
      pendingPieces,
      slaPct,
      riskLevel,
      criticalCount,
      overdueCount,
    }
  })

  return { zoneDetail }
}
