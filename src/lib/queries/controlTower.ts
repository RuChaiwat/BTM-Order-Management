import type { SupabaseClient } from '@supabase/supabase-js'
import { getDashboardData } from './dashboard'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds, fetchOrderZoneTouches } from './scopedFetch'
import { getSlaThresholds, computeTimeAlert, alertSeverityRank } from '../orderAlerts'

// Same reality as dashboard.ts: this app never actually sets an order or assignment_batch to
// 'in_progress' (no "picker started scanning" event exists), so treating it as a distinct state
// from 'assigned' just reads as a permanently-zero number. Anything meant to mean "still being
// worked, not yet submitted" checks both, plus 'correction_in_progress' for orders sent back.
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])
// Narrower than ACTIVE_ORDER_STATUSES: exactly the Picking phase (Assigned -> Confirm Pick), with
// no Verification-phase status mixed in. Used by the Warning/Overdue/Critical KPIs and Top Overdue
// Picks, which are meant to track picking lateness only -- Verification lateness has its own
// Pending Confirmation / Top Pending Confirmations below, on its own (later, looser) thresholds.
const PICKING_ONLY_STATUSES = new Set(['assigned', 'in_progress'])

/**
 * Control Tower has its own real-time-monitoring KPI set (all orders including cancelled, raw
 * picker-completion counts regardless of admin verification) which is deliberately different from
 * Operations Dashboard's management funnel (getDashboardData) — only `activePickers` (and its
 * pieces/orders-in-hand pair) and `actionRequired` are shared from there, everything else here is
 * computed from this function's own orders/alerts/completions fetch so the two pages can't
 * accidentally couple to the same shape and break each other when one is redesigned.
 */
export async function getControlTowerData(db: SupabaseClient, warehouseCode: string) {
  const [base, zones, orders, lines, assignmentBatches] = await Promise.all([
    getDashboardData(db, warehouseCode),
    getActiveZoneCodes(db, warehouseCode),
    fetchAllRows((from, to) =>
      db.from('orders').select('order_id, order_no, status, planned_pieces, assigned_time, warehouse_code, assignment_batch_id').eq('warehouse_code', warehouseCode).range(from, to),
    ),
    fetchOrderZoneTouches(db, warehouseCode),
    fetchAllRows((from, to) => db.from('assignment_batches').select('assignment_batch_id, zone_code').eq('warehouse_code', warehouseCode).range(from, to)),
  ])

  // order_alerts/picker_completions have no warehouse_code column, so both are fetched via an RPC
  // scoped to exactly this warehouse's order_ids (migration 0022) instead of the whole table.
  const orderIds = orders.map((o) => o.order_id)
  const [alerts, completions, thresholds] = await Promise.all([
    fetchScopedByOrderIds<{ order_id: string; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }>(
      db,
      'get_order_alerts_by_ids',
      'order_id, elapsed_minutes, is_picking_backlog, is_verification_backlog',
      orderIds,
    ),
    fetchScopedByOrderIds<{ order_id: string; actual_pieces: number | null; result: string; picker_completed_time: string }>(
      db,
      'get_picker_completions_by_ids',
      'order_id, actual_pieces, result, picker_completed_time',
      orderIds,
    ),
    getSlaThresholds(db),
  ])
  const orderStatusById = new Map(orders.map((o) => [o.order_id, o.status]))
  const alertByOrder = new Map(alerts.map((a) => [a.order_id, { ...a, time_alert: computeTimeAlert(orderStatusById.get(a.order_id) ?? '', a.elapsed_minutes, thresholds) }]))
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))
  const orderPiecesById = new Map(orders.map((o) => [o.order_id, o.planned_pieces ?? 0]))

  const zoneOrders = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrders.has(l.zone_code)) zoneOrders.set(l.zone_code, new Set())
    zoneOrders.get(l.zone_code)!.add(l.order_id)
  }

  // Row highlight must key off every zone an active order's OWN LINES actually touch, not just its
  // assignment batch's single declared zone_code -- FR-030's trigger only requires that ANY line of
  // the order sit in the batch's zone, not that EVERY line does (migration 0001's
  // enforce_assignment_zone_warehouse), so even a single (non-consolidated) batch can legitimately
  // cover an order whose lines span more than one physical zone, same as a consolidation-linked
  // batch (zone_code='MULTI', migration 0027) always could. Previously only the MULTI case was
  // attributed to every touched zone, so an order picked out of two zones under an ordinary batch
  // only ever flagged ONE of those zones -- the other showed on-track despite genuinely having that
  // same late order running in it too (see the identical fix in dashboard.ts).
  const zoneOfBatch = new Map(assignmentBatches.filter((b) => b.zone_code).map((b) => [b.assignment_batch_id, b.zone_code as string]))
  const activeOrderIdsByZone = new Map<string, string[]>()
  for (const o of orders) {
    if (!o.assignment_batch_id || !ACTIVE_ORDER_STATUSES.has(o.status)) continue
    if (!zoneOfBatch.get(o.assignment_batch_id)) continue
    const targetZones = [...zoneOrders.keys()].filter((z) => zoneOrders.get(z)!.has(o.order_id))
    for (const z of targetZones) {
      if (!activeOrderIdsByZone.has(z)) activeOrderIdsByZone.set(z, [])
      activeOrderIdsByZone.get(z)!.push(o.order_id)
    }
  }

  const zoneOverview = zones.map((zone) => {
    const touching = [...(zoneOrders.get(zone) ?? new Set())]
    const active = touching.filter((id) => ACTIVE_ORDER_STATUSES.has(orderStatusById.get(id) ?? '')).length
    const completed = touching.filter((id) => orderStatusById.get(id)?.startsWith('final_closed')).length
    const pickingBacklog = touching.filter((id) => alertByOrder.get(id)?.is_picking_backlog).length
    const verificationBacklog = touching.filter((id) => alertByOrder.get(id)?.is_verification_backlog).length
    const totalPieces = touching.reduce((s, id) => s + (orderPiecesById.get(id) ?? 0), 0)
    const slaPct = touching.length > 0 ? Math.round((completed / touching.length) * 1000) / 10 : 100
    // Row highlight: does any order actively being picked IN this zone right now carry a
    // warning/overdue/critical time alert, worst-first -- lets Admin spot which zones need
    // attention at a glance, consistent with Zone Dashboard's own risk badge for the same zone.
    const activeInZone = activeOrderIdsByZone.get(zone) ?? []
    const criticalCount = activeInZone.filter((id) => alertByOrder.get(id)?.time_alert === 'critical').length
    const overdueCount = activeInZone.filter((id) => alertByOrder.get(id)?.time_alert === 'overdue').length
    const warningCount = activeInZone.filter((id) => alertByOrder.get(id)?.time_alert === 'warning').length
    const riskLevel: 'critical' | 'overdue' | 'warning' | 'none' = criticalCount > 0 ? 'critical' : overdueCount > 0 ? 'overdue' : warningCount > 0 ? 'warning' : 'none'
    return { zone, orders: touching.length, totalPieces, pickingBacklog, verificationBacklog, active, completed, slaPct, riskLevel, criticalCount, overdueCount, warningCount }
  })

  const zonesByOrder = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
    zonesByOrder.get(l.order_id)!.add(l.zone_code)
  }

  // Picking only -- an order already past Picking and sitting in Admin Verification has its own
  // (looser) thresholds and its own list below; mixing the two in one "overdue picks" list would
  // mean a single number no longer maps to one consistent SLA.
  const overdueOrdersRaw = orders
    .filter((o) => PICKING_ONLY_STATUSES.has(o.status))
    .map((o) => ({ ...o, alert: alertByOrder.get(o.order_id), zones: [...(zonesByOrder.get(o.order_id) ?? new Set())] }))
    .filter((o) => o.alert?.time_alert === 'critical' || o.alert?.time_alert === 'overdue')
    .sort((a, b) => (b.alert?.elapsed_minutes ?? 0) - (a.alert?.elapsed_minutes ?? 0))
    .slice(0, 20)

  const verificationStatusOrders = orders.filter((o) => o.status === 'picker_completed_100' || o.status === 'picker_completed_short')
  // Worst alert across the WHOLE Verification queue, not just the top-20 slice below -- this is
  // what colors the Pending Confirmation KPI card itself (§ control-tower/page.tsx).
  const worstVerificationAlert = verificationStatusOrders.reduce<'warning' | 'overdue' | 'critical' | null>((worst, o) => {
    const alert = alertByOrder.get(o.order_id)?.time_alert ?? null
    return alertSeverityRank(alert) > alertSeverityRank(worst) ? alert : worst
  }, null)

  const pendingVerificationRaw = verificationStatusOrders
    .map((o) => ({ ...o, completion: completionByOrderId.get(o.order_id), alert: alertByOrder.get(o.order_id)?.time_alert ?? null }))
    // Most critical first -- a picker who's been waiting past Critical needs Admin's attention
    // before one still inside Warning, regardless of which submitted first.
    .sort((a, b) => alertSeverityRank(b.alert) - alertSeverityRank(a.alert) || (a.completion?.picker_completed_time ?? '').localeCompare(b.completion?.picker_completed_time ?? ''))
    .slice(0, 20)

  const batchIds = [
    ...new Set([...overdueOrdersRaw.map((o) => o.assignment_batch_id), ...pendingVerificationRaw.map((o) => o.assignment_batch_id)].filter(Boolean)),
  ] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))
  const pickerIds = [...new Set([...pickerIdByBatch.values()].filter(Boolean))] as string[]
  const pickersRes = pickerIds.length
    ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds)
    : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPickerId = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))
  const pickerNameFor = (batchId: string | null) => {
    const pickerId = batchId ? pickerIdByBatch.get(batchId) : null
    return pickerId ? nameByPickerId.get(pickerId) ?? pickerId : '—'
  }

  const overdueOrders = overdueOrdersRaw.map((o) => ({ ...o, pickerName: pickerNameFor(o.assignment_batch_id) }))

  const pendingVerification = pendingVerificationRaw.map((o) => ({
    orderId: o.order_id,
    orderNo: o.order_no,
    pickerName: pickerNameFor(o.assignment_batch_id),
    pieces: o.completion?.actual_pieces ?? 0,
    waitMinutes: o.completion ? Math.round((Date.now() - new Date(o.completion.picker_completed_time).getTime()) / 60000) : 0,
    timeAlert: o.alert,
  }))

  // Picking only -- see PICKING_ONLY_STATUSES above.
  const warningOrdersList = orders.filter((o) => PICKING_ONLY_STATUSES.has(o.status) && alertByOrder.get(o.order_id)?.time_alert === 'warning')
  const overdueOrdersList = orders.filter((o) => PICKING_ONLY_STATUSES.has(o.status) && alertByOrder.get(o.order_id)?.time_alert === 'overdue')
  const criticalOrdersList = orders.filter((o) => PICKING_ONLY_STATUSES.has(o.status) && alertByOrder.get(o.order_id)?.time_alert === 'critical')

  const pickingBacklogOrders = orders.filter((o) => alertByOrder.get(o.order_id)?.is_picking_backlog)
  const verificationBacklogOrders = orders.filter((o) => alertByOrder.get(o.order_id)?.is_verification_backlog)
  const inPickingOrders = orders.filter((o) => ACTIVE_ORDER_STATUSES.has(o.status))

  return {
    kpis: {
      totalOrders: orders.length,
      totalPlannedPieces: orders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
      piecesPicked: completions.reduce((s, c) => s + (c.actual_pieces ?? 0), 0),
      pickerCompletedCount: completions.length,
      pickerCompleted100: completions.filter((c) => c.result === '100_percent').length,
      pickerCompletedShort: completions.filter((c) => c.result === 'short').length,
      pickingBacklog: pickingBacklogOrders.length,
      pickingBacklogPieces: pickingBacklogOrders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
      verificationBacklog: verificationBacklogOrders.length,
      verificationBacklogPieces: verificationBacklogOrders.reduce((s, o) => s + (completionByOrderId.get(o.order_id)?.actual_pieces ?? 0), 0),
      activePickers: base.kpis.activePickers,
      activePickerTotalPieces: base.kpis.activePickerTotalPieces,
      activePickerTotalOrders: base.kpis.activePickerTotalOrders,
      // Shared 1:1 with Operations Dashboard's management funnel (§ getDashboardData) so both
      // pages agree on what "Completed"/"Backlog"/"Assigned"/"Pending Confirmation" mean.
      completedPieces: base.kpis.completedPieces,
      completedOrders: base.kpis.completedOrders,
      issuePieces: base.kpis.issuePieces,
      pctPiecesCompleted: base.kpis.pctPiecesCompleted,
      totalBacklogPieces: base.kpis.totalBacklogPieces,
      totalBacklogOrders: base.kpis.totalBacklogOrders,
      assignedPieces: base.kpis.assignedPieces,
      assignedOrders: base.kpis.assignedOrders,
      waitingVerifyPieces: base.kpis.waitingVerifyPieces,
      waitingVerifyOrders: base.kpis.waitingVerifyOrders,
    },
    flow: {
      assignment: inPickingOrders.length,
      assignmentPieces: inPickingOrders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
    },
    actionRequired: base.actionRequired,
    zoneOverview,
    topOverdueOrders: overdueOrders,
    pendingVerification,
    worstVerificationAlert,
    secondaryKpis: {
      warningOrders: warningOrdersList.length,
      warningPieces: warningOrdersList.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
      overdueOrders: overdueOrdersList.length,
      overduePieces: overdueOrdersList.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
      criticalOrders: criticalOrdersList.length,
      criticalPieces: criticalOrdersList.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
    },
  }
}
