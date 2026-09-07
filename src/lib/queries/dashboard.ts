import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'

// Any select scoped only by warehouse_code/status (no further narrowing) needs an explicit high
// limit — Supabase/PostgREST caps an unbounded select at 1000 rows by default, which silently
// truncated these once real order volume passed that (confirmed root cause of Dashboard/Zone
// Dashboard/Control Tower all under-reporting after a real import).
const ROW_CAP = 200000

const TERMINAL_CLOSED_STATUSES = new Set(['final_closed_100', 'final_closed_short'])
// assignment_batches.status is not a reliable "is this picker still working" signal: nothing in
// this app ever updates it after creation, so a batch stays 'assigned' forever even once every
// order in it has moved on to picker_completed/waiting_verification/final_closed. Using batch
// status to derive Active Pickers previously showed a picker as active with an empty roster,
// because the batch looked "assigned" while none of its orders actually were anymore. The only
// reliable signal is the orders themselves: a picker is active if they have at least one order
// still sitting in one of these statuses, which is also exactly Pick Completion's own queue.
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])

function daysBetween(fromDate: string, toDate: string): number {
  const [y1, m1, d1] = fromDate.split('-').map(Number)
  const [y2, m2, d2] = toDate.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000)
}

/**
 * Aggregates computed in JS after small raw-row fetches, not SQL views — fine at dev/demo scale.
 * At the §19 design capacity (5,000 orders/day) these should move into SQL views or an RPC
 * function; flagged rather than silently left as a scaling trap.
 */
export async function getDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [ordersRes, linesRes, assignmentBatchesRes, importErrorsRes, zones] = await Promise.all([
    db
      .from('orders')
      .select('order_id, status, planned_pieces, original_order_date, assigned_time, picker_completed_time, assignment_batch_id')
      .eq('warehouse_code', warehouseCode)
      .limit(ROW_CAP),
    db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
    db.from('assignment_batches').select('assignment_batch_id, picker_id, status, zone_code').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
    db.from('import_errors').select('error_id, error_reason').ilike('error_reason', '%Invalid Bin Code%').limit(ROW_CAP),
    getActiveZoneCodes(db, warehouseCode),
  ])
  if (ordersRes.error) console.error('[dashboard] orders error', ordersRes.error.message)
  if (linesRes.error) console.error('[dashboard] order_lines error', linesRes.error.message)
  if (assignmentBatchesRes.error) console.error('[dashboard] assignment_batches error', assignmentBatchesRes.error.message)

  const orders = ordersRes.data ?? []
  const lines = linesRes.data ?? []
  const assignmentBatches = assignmentBatchesRes.data ?? []
  const invalidBinErrors = importErrorsRes.data ?? []

  const orderIds = orders.map((o) => o.order_id)
  // order_alerts has no warehouse_code column (it's a plain derived view over all orders), so it
  // must be scoped via order_id here rather than fetched unfiltered — that unfiltered fetch was
  // also part of the truncation bug, pulling an arbitrary slice of every warehouse's alerts.
  const [completionsRes, alertsRes] = await Promise.all([
    orderIds.length
      ? db.from('picker_completions').select('order_id, actual_pieces, picker_completed_time, result').in('order_id', orderIds).limit(ROW_CAP)
      : Promise.resolve({ data: [] as { order_id: string; actual_pieces: number; picker_completed_time: string; result: string }[], error: null }),
    orderIds.length
      ? db.from('order_alerts').select('order_id, time_alert, is_picking_backlog, is_verification_backlog').in('order_id', orderIds).limit(ROW_CAP)
      : Promise.resolve({ data: [] as { order_id: string; time_alert: string | null; is_picking_backlog: boolean; is_verification_backlog: boolean }[], error: null }),
  ])
  const completions = unwrap(completionsRes)
  const alerts = unwrap(alertsRes)
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))

  // §management KPI funnel: Total Orders -> Assigned -> Completed (admin-verified only) -> %
  // Completed -> Total Backlog. Cancelled orders are excluded from every stage here -- they were
  // deliberately taken out of the workflow, so counting them as "imported" or as "backlog" would
  // be misleading for a decision-making view.
  const activeOrders = orders.filter((o) => o.status !== 'cancelled')
  const totalOrders = activeOrders.length
  const totalPieces = activeOrders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)

  const assignedOrdersList = activeOrders.filter((o) => o.assignment_batch_id)
  const assignedOrders = assignedOrdersList.length
  const assignedPieces = assignedOrdersList.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)

  // Pending Confirmation: picker has already submitted a completion for these (status lands on
  // picker_completed_100/short, never the unused 'waiting_admin_verification' enum value — Admin
  // Verification's own queue query confirms this is the real pair), they're just sitting in Admin
  // Verification's queue -- distinct from "Completed" below, which only counts orders the admin
  // has actually confirmed closed.
  const waitingVerifyOrdersList = activeOrders.filter((o) => o.status === 'picker_completed_100' || o.status === 'picker_completed_short')
  const waitingVerifyOrders = waitingVerifyOrdersList.length
  const waitingVerifyPieces = waitingVerifyOrdersList.reduce((s, o) => s + (completionByOrderId.get(o.order_id)?.actual_pieces ?? 0), 0)

  const completedOrdersList = activeOrders.filter((o) => TERMINAL_CLOSED_STATUSES.has(o.status))
  const completedOrders = completedOrdersList.length
  const completedPieces = completedOrdersList.reduce((s, o) => s + (completionByOrderId.get(o.order_id)?.actual_pieces ?? 0), 0)

  // % Completed counts pieces, not orders, and treats a short-picked order that was still closed
  // as "accounted for" -- the gap between what was ordered and what was actually picked on a
  // final_closed_short order is "issue" pieces (acknowledged missing, not simply unworked), so it
  // counts toward the percentage alongside the pieces that were fully picked. e.g. Total 100,
  // Completed 85, Issue 5 -> 90% (the remaining 10 haven't been touched at all yet).
  const issuePieces = activeOrders
    .filter((o) => o.status === 'final_closed_short')
    .reduce((s, o) => s + Math.max(0, (o.planned_pieces ?? 0) - (completionByOrderId.get(o.order_id)?.actual_pieces ?? 0)), 0)
  const pctPiecesCompleted = totalPieces > 0 ? Math.round(((completedPieces + issuePieces) / totalPieces) * 1000) / 10 : 0
  const totalBacklogOrders = totalOrders - completedOrders
  const totalBacklogPieces = totalPieces - completedPieces

  // Backlog by Order Date: every non-cancelled order that hasn't reached admin-verified close yet,
  // grouped by its original (WMS) order date. Only dates that actually have backlog appear.
  const today = new Date().toISOString().slice(0, 10)
  const backlogByDateMap = new Map<string, { orders: number; pieces: number }>()
  for (const o of activeOrders) {
    if (TERMINAL_CLOSED_STATUSES.has(o.status)) continue
    const entry = backlogByDateMap.get(o.original_order_date) ?? { orders: 0, pieces: 0 }
    entry.orders += 1
    entry.pieces += o.planned_pieces ?? 0
    backlogByDateMap.set(o.original_order_date, entry)
  }
  const backlogByDate = [...backlogByDateMap.entries()]
    .map(([orderDate, v]) => ({ orderDate, orders: v.orders, pieces: v.pieces, daysOld: daysBetween(orderDate, today) }))
    .sort((a, b) => a.orderDate.localeCompare(b.orderDate))

  const alertByOrder = new Map(alerts.map((a) => [a.order_id, a]))
  const critical = orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'critical').length
  const overdue = orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'overdue').length
  const statusCounts = new Map<string, number>()
  for (const o of orders) statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1)

  const zoneOrders = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrders.has(l.zone_code)) zoneOrders.set(l.zone_code, new Set())
    zoneOrders.get(l.zone_code)!.add(l.order_id)
  }
  const orderStatusById = new Map(orders.map((o) => [o.order_id, o.status]))
  const orderPiecesById = new Map(orders.map((o) => [o.order_id, o.planned_pieces ?? 0]))
  const zoneStatus = zones.map((zone) => {
    const touching = [...(zoneOrders.get(zone) ?? new Set())]
    const closedIds = touching.filter((id) => orderStatusById.get(id)?.startsWith('final_closed'))
    const totalPieces = touching.reduce((s, id) => s + (orderPiecesById.get(id) ?? 0), 0)
    // Pieces Pending drops as Admin confirms each order in this zone -- Total Pieces is the
    // stable denominator it's shrinking against.
    const pendingPieces = touching.filter((id) => !closedIds.includes(id)).reduce((s, id) => s + (orderPiecesById.get(id) ?? 0), 0)
    const slaPct = touching.length > 0 ? Math.round((closedIds.length / touching.length) * 1000) / 10 : 100
    return { zone, orders: touching.length, totalPieces, pendingPieces, slaPct, onTrack: slaPct >= 85 }
  })

  const batchByAssignmentId = new Map(assignmentBatches.map((b) => [b.assignment_batch_id, b]))
  const orderById = new Map(orders.map((o) => [o.order_id, o]))

  const pickerTotals = new Map<string, { pieces: number; minutes: number }>()
  for (const c of completions) {
    const order = orderById.get(c.order_id)
    const pickerId = order?.assignment_batch_id ? batchByAssignmentId.get(order.assignment_batch_id)?.picker_id : null
    if (!pickerId || !order?.assigned_time) continue
    const minutes = (new Date(c.picker_completed_time).getTime() - new Date(order.assigned_time).getTime()) / 60000
    const entry = pickerTotals.get(pickerId) ?? { pieces: 0, minutes: 0 }
    entry.pieces += c.actual_pieces ?? 0
    entry.minutes += Math.max(minutes, 1)
    pickerTotals.set(pickerId, entry)
  }

  // Active pickers right now: which orders are still sitting in an active status (handed to a
  // picker but not yet submitted), broken down per picker for the roster below Zone Status.
  // Active Pickers itself (below) is just this map's size, so the KPI and the roster it explains
  // can never disagree with each other.
  const pickerIdByBatchId = new Map(assignmentBatches.filter((b) => b.picker_id).map((b) => [b.assignment_batch_id, b.picker_id as string]))
  const activePickerWork = new Map<string, { orders: number; pieces: number }>()
  for (const o of orders) {
    if (!o.assignment_batch_id) continue
    if (!ACTIVE_ORDER_STATUSES.has(o.status)) continue
    const pickerId = pickerIdByBatchId.get(o.assignment_batch_id)
    if (!pickerId) continue
    const entry = activePickerWork.get(pickerId) ?? { orders: 0, pieces: 0 }
    entry.orders += 1
    entry.pieces += o.planned_pieces ?? 0
    activePickerWork.set(pickerId, entry)
  }
  const activePickers = activePickerWork.size
  const activePickerTotalPieces = [...activePickerWork.values()].reduce((s, w) => s + w.pieces, 0)

  const pickerIds = [...new Set([...pickerTotals.keys(), ...activePickerWork.keys()])]
  const pickerNamesRes = pickerIds.length
    ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds)
    : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPickerId = new Map(unwrap(pickerNamesRes).map((p) => [p.user_id, p.name_en]))

  const pickerProductivity = [...pickerTotals.entries()]
    .map(([pickerId, t]) => ({ pickerId, name: nameByPickerId.get(pickerId) ?? pickerId, pcsPerHour: Math.round((t.pieces / t.minutes) * 60) }))
    .sort((a, b) => b.pcsPerHour - a.pcsPerHour)
    .slice(0, 6)

  const activePickerRoster = [...activePickerWork.entries()]
    .map(([pickerId, w]) => ({ pickerId, name: nameByPickerId.get(pickerId) ?? pickerId, orders: w.orders, pieces: w.pieces }))
    .sort((a, b) => b.pieces - a.pieces)

  return {
    kpis: {
      totalOrders,
      totalPieces,
      assignedOrders,
      assignedPieces,
      waitingVerifyOrders,
      waitingVerifyPieces,
      completedOrders,
      completedPieces,
      issuePieces,
      pctPiecesCompleted,
      totalBacklogOrders,
      totalBacklogPieces,
      activePickers,
      activePickerTotalPieces,
    },
    backlogByDate,
    statusCounts: Object.fromEntries(statusCounts),
    zoneStatus,
    pickerProductivity,
    activePickerRoster,
    actionRequired: {
      critical,
      overdue,
      waitingVerification: waitingVerifyOrders,
      correctionInProgress: (statusCounts.get('admin_rejected') ?? 0) + (statusCounts.get('correction_in_progress') ?? 0),
      invalidBinCode: invalidBinErrors.length,
    },
  }
}
