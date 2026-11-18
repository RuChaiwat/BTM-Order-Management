import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds } from './scopedFetch'
import { bangkokDateKey } from '../formatDate'
import { getSlaThresholds, computeTimeAlert } from '../orderAlerts'
import { PICK_STAGES, pickStageOf, type PickStage } from '../pickBacklog'

const TERMINAL_CLOSED_STATUSES = new Set(['final_closed_100', 'final_closed_short'])
// assignment_batches.status is not a reliable "is this picker still working" signal: nothing in
// this app ever updates it after creation, so a batch stays 'assigned' forever even once every
// order in it has moved on to picker_completed/waiting_verification/final_closed. The only
// reliable signal is the orders themselves: a picker is active if they have at least one order
// still sitting in one of these statuses, which is also exactly Pick Completion's own queue.
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])

/**
 * Pick side of Operations Dashboard (Control Tower also reuses `kpis` and `actionRequired`).
 * Aggregates computed in JS after small raw-row fetches, not SQL views — fine at dev/demo scale.
 * At the §19 design capacity (5,000 orders/day) these should move into SQL views or an RPC
 * function; flagged rather than silently left as a scaling trap.
 */
export async function getDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [orders, assignmentBatches, invalidBinCount] = await Promise.all([
    fetchAllRows((from, to) =>
      db
        .from('orders')
        .select('order_id, status, planned_pieces, original_order_date, assignment_batch_id, created_at')
        .eq('warehouse_code', warehouseCode)
        .range(from, to),
    ),
    fetchAllRows((from, to) => db.from('assignment_batches').select('assignment_batch_id, picker_id').eq('warehouse_code', warehouseCode).range(from, to)),
    // Only the count is used below -- a head request returns it via Content-Range without
    // transferring any rows, so it's naturally immune to the row cap rather than needing paging.
    db.from('import_errors').select('error_id', { count: 'exact', head: true }).ilike('error_reason', '%Invalid Bin Code%'),
  ])

  // order_alerts/picker_completions have no warehouse_code column, so both are fetched via an RPC
  // scoped to exactly this warehouse's order_ids (migration 0022) -- sent in the POST body, not the
  // URL, so it stays correct no matter how many orders this warehouse has.
  const orderIds = orders.map((o) => o.order_id)
  const [completions, alerts, thresholds] = await Promise.all([
    fetchScopedByOrderIds<{ order_id: string; actual_pieces: number | null; picker_completed_time: string; result: string }>(
      db,
      'get_picker_completions_by_ids',
      'order_id, actual_pieces, picker_completed_time, result',
      orderIds,
    ),
    fetchScopedByOrderIds<{ order_id: string; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }>(
      db,
      'get_order_alerts_by_ids',
      'order_id, elapsed_minutes, is_picking_backlog, is_verification_backlog',
      orderIds,
    ),
    getSlaThresholds(db),
  ])
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))
  const statusByOrderId = new Map(orders.map((o) => [o.order_id, o.status]))

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
  // picker_completed_100/short), they're just sitting in Admin Verification's queue -- distinct
  // from "Completed" below, which only counts orders the admin has actually confirmed closed.
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

  const alertByOrder = new Map(alerts.map((a) => [a.order_id, { ...a, time_alert: computeTimeAlert(statusByOrderId.get(a.order_id) ?? '', a.elapsed_minutes, thresholds) }]))
  const critical = orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'critical').length
  const overdue = orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'overdue').length
  const statusCounts = new Map<string, number>()
  for (const o of orders) statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1)

  // Active pickers right now: pickers with at least one order still in an active status.
  const pickerIdByBatchId = new Map(assignmentBatches.filter((b) => b.picker_id).map((b) => [b.assignment_batch_id, b.picker_id as string]))
  const activePickerWork = new Map<string, { orders: number; pieces: number }>()
  for (const o of orders) {
    if (!o.assignment_batch_id || !ACTIVE_ORDER_STATUSES.has(o.status)) continue
    const pickerId = pickerIdByBatchId.get(o.assignment_batch_id)
    if (!pickerId) continue
    const entry = activePickerWork.get(pickerId) ?? { orders: 0, pieces: 0 }
    entry.orders += 1
    entry.pieces += o.planned_pieces ?? 0
    activePickerWork.set(pickerId, entry)
  }
  const activePickers = activePickerWork.size
  const activePickerTotalPieces = [...activePickerWork.values()].reduce((s, w) => s + w.pieces, 0)
  const activePickerTotalOrders = [...activePickerWork.values()].reduce((s, w) => s + w.orders, 0)

  // Pick backlog by order date, split by stage (รอหยิบ / กำลังหยิบ incl. Admin send-backs / รอ Admin
  // ยืนยัน): every non-cancelled order not yet admin-closed. "oldest" = longest time since import.
  const nowMs = Date.now()
  type StageCounts = Record<PickStage, { orders: number; pieces: number }>
  const emptyStages = () => Object.fromEntries(PICK_STAGES.map((s) => [s, { orders: 0, pieces: 0 }])) as StageCounts
  const pickBacklogMap = new Map<string, { orderDate: string; orders: number; pieces: number; byStage: StageCounts; oldestMinutes: number }>()
  const pickBacklogTotal = { orders: 0, pieces: 0, byStage: emptyStages() }
  for (const o of activeOrders) {
    const stage = pickStageOf(o.status)
    if (!stage) continue
    const pcs = o.planned_pieces ?? 0
    let row = pickBacklogMap.get(o.original_order_date)
    if (!row) {
      row = { orderDate: o.original_order_date, orders: 0, pieces: 0, byStage: emptyStages(), oldestMinutes: 0 }
      pickBacklogMap.set(o.original_order_date, row)
    }
    for (const r of [row, pickBacklogTotal]) {
      r.orders++
      r.pieces += pcs
      r.byStage[stage].orders++
      r.byStage[stage].pieces += pcs
    }
    if (o.created_at) row.oldestMinutes = Math.max(row.oldestMinutes, Math.round(Math.max(0, nowMs - new Date(o.created_at).getTime()) / 60000))
  }
  const pickBacklog = [...pickBacklogMap.values()].sort((a, b) => a.orderDate.localeCompare(b.orderDate))

  // Orders still being picked (assigned / in progress) by their SLA alert -- same thresholds and
  // alert as Zone Dashboard / Control Tower.
  const pickInProgress = { warning: 0, overdue: 0, critical: 0 }
  for (const o of activeOrders) {
    if (o.status !== 'assigned' && o.status !== 'in_progress') continue
    const a = alertByOrder.get(o.order_id)?.time_alert
    if (a) pickInProgress[a]++
  }

  // Pieces pickers actually submitted in the last 60 minutes (whole team), and when today's first
  // submission happened -- the forecast only shows once a full hour of work exists.
  const todayBangkok = bangkokDateKey(new Date())
  let pickLastHourPieces = 0
  let pickFirstTodayMs: number | null = null
  for (const c of completions) {
    if (!c.picker_completed_time || bangkokDateKey(c.picker_completed_time) !== todayBangkok) continue
    const t = new Date(c.picker_completed_time).getTime()
    pickFirstTodayMs = pickFirstTodayMs === null ? t : Math.min(pickFirstTodayMs, t)
    if (nowMs - t <= 3600000) pickLastHourPieces += c.actual_pieces ?? 0
  }

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
      activePickerTotalOrders,
      activePickerTotalPieces,
    },
    pickBacklog,
    pickBacklogTotal,
    pickInProgress,
    pickLastHour: { pieces: pickLastHourPieces, firstAt: pickFirstTodayMs === null ? null : new Date(pickFirstTodayMs).toISOString() },
    pickThresholds: { warning: thresholds.pickWarningMinutes, overdue: thresholds.pickOverdueMinutes, critical: thresholds.pickCriticalMinutes },
    actionRequired: {
      critical,
      overdue,
      waitingVerification: waitingVerifyOrders,
      correctionInProgress: (statusCounts.get('admin_rejected') ?? 0) + (statusCounts.get('correction_in_progress') ?? 0),
      invalidBinCode: invalidBinCount.count ?? 0,
    },
  }
}
