import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'
import { fetchAllRows } from './fetchAllRows'

// Same reality as dashboard.ts: this app never actually sets an order or assignment_batch to
// 'in_progress' (no "picker started scanning" event exists) -- every live order/batch just sits
// at 'assigned' until the picker submits a completion. Anything meaning "still being worked"
// checks all three of these instead of trusting 'in_progress' alone.
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])
const TERMINAL_CLOSED_STATUSES = new Set(['final_closed_100', 'final_closed_short'])

/** §12/§13 Zone Dashboard — a zone-level drill-down of Control Tower's zone overview: which
 * orders touch each zone, who is actively picking there, and each zone's backlog/SLA. */
export async function getZoneDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [lines, orders, batches, zones] = await Promise.all([
    fetchAllRows((from, to) => db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode).range(from, to)),
    fetchAllRows((from, to) => db.from('orders').select('order_id, order_no, status, assignment_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).range(from, to)),
    fetchAllRows((from, to) => db.from('assignment_batches').select('assignment_batch_id, picker_id, zone_code, status').eq('warehouse_code', warehouseCode).range(from, to)),
    getActiveZoneCodes(db, warehouseCode),
  ])

  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const pickerIdByBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))

  // order_alerts has no warehouse_code column — scope it via this warehouse's own order_ids
  // rather than fetching every warehouse's alerts unfiltered (part of the original truncation bug).
  const orderIds = orders.map((o) => o.order_id)
  const [alerts, completions] = await Promise.all([
    orderIds.length
      ? fetchAllRows((from, to) =>
          db.from('order_alerts').select('order_id, time_alert, elapsed_minutes, is_picking_backlog, is_verification_backlog').in('order_id', orderIds).range(from, to),
        )
      : Promise.resolve([] as { order_id: string; time_alert: string | null; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }[]),
    orderIds.length
      ? fetchAllRows((from, to) => db.from('picker_completions').select('order_id, actual_pieces').in('order_id', orderIds).range(from, to))
      : Promise.resolve([] as { order_id: string; actual_pieces: number }[]),
  ])
  const alertByOrder = new Map(alerts.map((a) => [a.order_id, a]))
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))

  const pickerIds = [...new Set(batches.map((b) => b.picker_id).filter(Boolean))] as string[]
  const pickersRes = pickerIds.length ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds) : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))

  const zoneOrderIds = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrderIds.has(l.zone_code)) zoneOrderIds.set(l.zone_code, new Set())
    zoneOrderIds.get(l.zone_code)!.add(l.order_id)
  }

  // Active pickers per zone, by picker id -> real pieces/orders currently in hand -- derived from
  // the ORDERS' own status (the only reliable "still being worked" signal), not
  // assignment_batches.status, which never advances past 'assigned' even once every order in it
  // has moved on (see dashboard.ts for the full explanation; same fix applied here).
  const zoneOfBatch = new Map(batches.filter((b) => b.zone_code).map((b) => [b.assignment_batch_id, b.zone_code as string]))
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
  }

  const zoneDetail = zones.map((zone) => {
    const touching = [...(zoneOrderIds.get(zone) ?? new Set())]
      .map((id) => orderById.get(id))
      .filter((o): o is NonNullable<typeof o> => Boolean(o))
      .map((o) => {
        const alert = alertByOrder.get(o.order_id)
        const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
        return { ...o, alert, pickerName: pickerId ? nameByPicker.get(pickerId) ?? pickerId : '—' }
      })
      .sort((a, b) => (b.alert?.elapsed_minutes ?? 0) - (a.alert?.elapsed_minutes ?? 0))

    const closed = touching.filter((o) => TERMINAL_CLOSED_STATUSES.has(o.status ?? ''))
    const totalPieces = touching.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
    const pendingPieces = totalPieces - closed.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
    const slaPct = touching.length > 0 ? Math.round((closed.length / touching.length) * 1000) / 10 : 100

    const pickerWork = zonePickerWork.get(zone)
    const activePickerTotalPieces = pickerWork ? [...pickerWork.values()].reduce((s, w) => s + w.pieces, 0) : 0
    const activePickerTotalOrders = pickerWork ? [...pickerWork.values()].reduce((s, w) => s + w.orders, 0) : 0

    return {
      zone,
      orders: touching,
      activePickers: pickerWork?.size ?? 0,
      activePickerTotalPieces,
      activePickerTotalOrders,
      assigned: touching.filter((o) => o.status === 'assigned').length,
      correctionInProgress: touching.filter((o) => o.status === 'correction_in_progress').length,
      completed: closed.length,
      pickingBacklog: touching.filter((o) => o.alert?.is_picking_backlog).length,
      verificationBacklog: touching.filter((o) => o.alert?.is_verification_backlog).length,
      verificationBacklogPieces: touching.filter((o) => o.alert?.is_verification_backlog).reduce((s, o) => s + (completionByOrderId.get(o.order_id)?.actual_pieces ?? 0), 0),
      critical: touching.filter((o) => o.alert?.time_alert === 'critical').length,
      overdue: touching.filter((o) => o.alert?.time_alert === 'overdue').length,
      totalPieces,
      pendingPieces,
      slaPct,
    }
  })

  return { zoneDetail }
}
