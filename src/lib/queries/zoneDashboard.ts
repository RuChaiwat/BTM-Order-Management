import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds, fetchOrderZoneTouches } from './scopedFetch'
import { getSlaThresholds, computeTimeAlert } from '../orderAlerts'

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
  pickerEmploymentType: string | null
  elapsedMinutes: number
  timeAlert: string | null
}

export interface ZoneShortPickRow {
  orderId: string
  orderNo: string
  sku: string
  pickerName: string
  pickerEmploymentType: string | null
  orderedQty: number
  shortQty: number
  reason: string
}

/** §12/§13 Zone Dashboard — a zone-level drill-down of Control Tower's zone overview: which
 * orders touch each zone, who is actively picking there, and each zone's backlog/SLA. */
export async function getZoneDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [zoneTouches, orders, batches, zones] = await Promise.all([
    // order_lines is by far the largest table in this schema (many lines per order) -- a lightweight
    // RPC (migration 0023) returns only the DISTINCT (order_id, zone_code) pairs this needs for the
    // "which zone(s) does this order touch" map below, instead of pulling every line.
    fetchOrderZoneTouches(db, warehouseCode),
    fetchAllRows((from, to) => db.from('orders').select('order_id, order_no, status, assignment_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).range(from, to)),
    fetchAllRows((from, to) => db.from('assignment_batches').select('assignment_batch_id, picker_id, zone_code, status').eq('warehouse_code', warehouseCode).range(from, to)),
    getActiveZoneCodes(db, warehouseCode),
  ])

  // How many of an order's pieces are REALLY in a given zone, not its whole planned_pieces
  // repeated in every zone it merely touches -- an order split A1=8/R1=2 must contribute 8 to A1
  // and 2 to R1 (sum = 10), not 10 to each (sum = 20, which is what zoneOrderIds + planned_pieces
  // alone would give, and is why zone totals here used to add up to more than Backlog's own Total
  // Pieces for the same orders). get_order_line_zone_pieces_by_ids (migration 0026) fixed the same
  // bug for Matching Dashboard but only returns one row per zone (every given order summed
  // together); this one (migration 0034) keeps order_id too, since pendingPieces below still needs
  // to decide per ORDER whether its zone pieces count as pending or done.
  const orderIds = orders.map((o) => o.order_id)
  const zonePiecesRows = await fetchScopedByOrderIds<{ order_id: string; zone_code: string; pieces: number }>(
    db,
    'get_order_line_zone_pieces_by_order',
    'order_id, zone_code, pieces',
    orderIds,
  )
  const piecesByOrderZone = new Map<string, Map<string, number>>()
  for (const r of zonePiecesRows) {
    if (!piecesByOrderZone.has(r.order_id)) piecesByOrderZone.set(r.order_id, new Map())
    piecesByOrderZone.get(r.order_id)!.set(r.zone_code, Number(r.pieces))
  }
  const piecesForOrderInZone = (orderId: string, zone: string): number => piecesByOrderZone.get(orderId)?.get(zone) ?? 0

  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const pickerIdByBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))

  // order_alerts/picker_completions have no warehouse_code column, so both are fetched via an RPC
  // scoped to exactly this warehouse's order_ids (migration 0022) instead of the whole table.
  // picker_completion_lines has neither warehouse_code nor order_id, only completion_id -- fetched
  // whole (its own row count is bounded by how many lines were ever short-picked, not by total
  // order volume) and matched back to an order via completionById below, which is itself already
  // scoped to this warehouse.
  const [alerts, completions, allShortLines, reasonRows, thresholds] = await Promise.all([
    fetchScopedByOrderIds<{ order_id: string; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }>(
      db,
      'get_order_alerts_by_ids',
      'order_id, elapsed_minutes, is_picking_backlog, is_verification_backlog',
      orderIds,
    ),
    fetchScopedByOrderIds<{ completion_id: string; order_id: string; actual_pieces: number | null }>(db, 'get_picker_completions_by_ids', 'completion_id, order_id, actual_pieces', orderIds),
    fetchAllRows((from, to) => db.from('picker_completion_lines').select('completion_id, line_id, ordered_qty, picked_qty, short_reason_code').eq('is_short', true).range(from, to)),
    db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick'),
    getSlaThresholds(db),
  ])
  const alertByOrder = new Map(alerts.map((a) => [a.order_id, { ...a, time_alert: computeTimeAlert(orderById.get(a.order_id)?.status ?? '', a.elapsed_minutes, thresholds) }]))
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))
  const completionById = new Map(completions.map((c) => [c.completion_id, c]))
  const reasonLabelByCode = new Map(unwrap(reasonRows).map((r) => [r.reason_code, r.label_en]))

  // lineById only ever needs to resolve the specific lines that were actually short-picked (a
  // small fraction of all lines), not every order_line in the warehouse -- fetched by exact
  // line_id instead of pulling the whole table.
  const shortLineIds = [...new Set(allShortLines.map((l) => l.line_id))]
  const lineDetailRes = shortLineIds.length
    ? await db.from('order_lines').select('line_id, sku, zone_code').in('line_id', shortLineIds)
    : { data: [] as { line_id: string; sku: string; zone_code: string | null }[] }
  const lineById = new Map(unwrap(lineDetailRes).map((l) => [l.line_id, l]))

  const pickerIds = [...new Set(batches.map((b) => b.picker_id).filter(Boolean))] as string[]
  const [pickersRes, employmentTypeRows] = await Promise.all([
    pickerIds.length ? db.from('pickers').select('picker_id, name_en, employment_type').in('picker_id', pickerIds) : Promise.resolve({ data: [] as { picker_id: string; name_en: string; employment_type: string | null }[] }),
    db.from('picker_employment_types').select('type_code, label_en'),
  ])
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))
  const employmentTypeByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.employment_type]))
  const employmentTypeLabel = new Map(unwrap(employmentTypeRows).map((t) => [t.type_code, t.label_en]))
  const pickerNameForOrder = (o: (typeof orders)[number]) => {
    const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
    return pickerId ? nameByPicker.get(pickerId) ?? pickerId : '—'
  }
  const employmentTypeLabelForPicker = (pickerId: string | null | undefined): string | null => {
    const code = pickerId ? employmentTypeByPicker.get(pickerId) : null
    return code ? employmentTypeLabel.get(code) ?? code : null
  }
  const pickerEmploymentTypeForOrder = (o: (typeof orders)[number]): string | null => {
    const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
    return employmentTypeLabelForPicker(pickerId)
  }

  const zoneOrderIds = new Map<string, Set<string>>()
  for (const t of zoneTouches) {
    if (!zoneOrderIds.has(t.zone_code)) zoneOrderIds.set(t.zone_code, new Set())
    zoneOrderIds.get(t.zone_code)!.add(t.order_id)
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
      pickerEmploymentType: pickerEmploymentTypeForOrder(order),
      orderedQty: sl.ordered_qty,
      shortQty: Math.max(0, sl.ordered_qty - sl.picked_qty),
      reason: sl.short_reason_code ? reasonLabelByCode.get(sl.short_reason_code) ?? sl.short_reason_code : '—',
    }
    if (!shortPickRowsByZone.has(line.zone_code)) shortPickRowsByZone.set(line.zone_code, [])
    shortPickRowsByZone.get(line.zone_code)!.push(row)
  }

  // Which zone(s) an ACTIVE order is really being worked in -- every zone the order's OWN LINES
  // actually touch, not just its assignment batch's single declared zone_code. FR-030's trigger
  // (enforce_assignment_zone_warehouse, migration 0001) only requires that ANY line of the order
  // sit in the batch's zone, not that EVERY line does, so even a single (non-consolidated) batch
  // can legitimately cover an order whose lines span more than one physical zone -- same as a
  // consolidation-linked batch (zone_code='MULTI', migration 0027) always could. Previously only
  // the MULTI case was attributed to every touched zone, so a picker working an ordinary batch on
  // a 2-zone order only ever showed as active in ONE of those zones, and that zone's own risk badge
  // only ever reflected that order's lateness in one place instead of both.
  //
  // Both the Orders list AND Active Pickers are derived from this one map, so they can't disagree
  // with each other the way they used to when batch zone_code and line-touch were used separately.
  const zoneOfBatch = new Map(batches.filter((b) => b.zone_code).map((b) => [b.assignment_batch_id, b.zone_code as string]))
  const activeOrdersByZone = new Map<string, ZoneActiveOrderRow[]>()
  const zonePickerWork = new Map<string, Map<string, { orders: number; pieces: number }>>()
  for (const o of orders) {
    if (!o.assignment_batch_id || !ACTIVE_ORDER_STATUSES.has(o.status)) continue
    const batchZone = zoneOfBatch.get(o.assignment_batch_id)
    const pickerId = pickerIdByBatch.get(o.assignment_batch_id)
    if (!batchZone || !pickerId) continue
    const targetZones = [...zoneOrderIds.keys()].filter((z) => zoneOrderIds.get(z)!.has(o.order_id))

    const alert = alertByOrder.get(o.order_id)
    for (const zone of targetZones) {
      if (!zonePickerWork.has(zone)) zonePickerWork.set(zone, new Map())
      const perPicker = zonePickerWork.get(zone)!
      const entry = perPicker.get(pickerId) ?? { orders: 0, pieces: 0 }
      entry.orders += 1
      entry.pieces += piecesForOrderInZone(o.order_id, zone)
      perPicker.set(pickerId, entry)

      if (!activeOrdersByZone.has(zone)) activeOrdersByZone.set(zone, [])
      activeOrdersByZone.get(zone)!.push({
        orderId: o.order_id,
        orderNo: o.order_no,
        status: o.status,
        pickerName: nameByPicker.get(pickerId) ?? pickerId,
        pickerEmploymentType: employmentTypeLabelForPicker(pickerId),
        elapsedMinutes: Math.round(alert?.elapsed_minutes ?? 0),
        timeAlert: alert?.time_alert ?? null,
      })
    }
  }

  const zoneDetail = zones.map((zone) => {
    const touching = [...(zoneOrderIds.get(zone) ?? new Set())]
      .map((id) => orderById.get(id))
      .filter((o): o is NonNullable<typeof o> => Boolean(o))

    const closed = touching.filter((o) => TERMINAL_CLOSED_STATUSES.has(o.status ?? ''))
    const pickingDone = touching.filter((o) => PICKING_DONE_STATUSES.has(o.status ?? ''))
    // Real pieces THIS zone is responsible for, not an order's whole planned_pieces repeated in
    // every zone it touches (see piecesForOrderInZone's own comment above).
    const totalPieces = touching.reduce((s, o) => s + piecesForOrderInZone(o.order_id, zone), 0)
    // Drops once the picker submits, not only once Admin verifies -- see dashboard.ts.
    const pendingPieces = totalPieces - pickingDone.reduce((s, o) => s + piecesForOrderInZone(o.order_id, zone), 0)
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
