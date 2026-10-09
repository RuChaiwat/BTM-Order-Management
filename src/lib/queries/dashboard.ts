import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds, fetchOrderZoneTouches } from './scopedFetch'
import { getActiveConfig } from './config'
import { bangkokDateKey } from '../formatDate'
import { bandForPct, computeRoundBasedRate, type RoundCompletion } from '../pickerProductivity'
import { getSlaThresholds, computeTimeAlert } from '../orderAlerts'

const TERMINAL_CLOSED_STATUSES = new Set(['final_closed_100', 'final_closed_short'])
// assignment_batches.status is not a reliable "is this picker still working" signal: nothing in
// this app ever updates it after creation, so a batch stays 'assigned' forever even once every
// order in it has moved on to picker_completed/waiting_verification/final_closed. Using batch
// status to derive Active Pickers previously showed a picker as active with an empty roster,
// because the batch looked "assigned" while none of its orders actually were anymore. The only
// reliable signal is the orders themselves: a picker is active if they have at least one order
// still sitting in one of these statuses, which is also exactly Pick Completion's own queue.
const ACTIVE_ORDER_STATUSES = new Set(['assigned', 'in_progress', 'correction_in_progress'])
// "Picking done" for Zone Status's Pieces Pending -- once the picker submits, the zone's physical
// picking work is finished even though Admin hasn't verified it yet, so it should stop counting as
// pending workload for that zone. Deliberately broader than TERMINAL_CLOSED_STATUSES, which is
// reserved for the Completed/% Completed KPIs (admin-verified only, on purpose).
const PICKING_DONE_STATUSES = new Set(['picker_completed_100', 'picker_completed_short', 'final_closed_100', 'final_closed_short'])

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
  const [orders, lines, assignmentBatches, invalidBinCount, zones] = await Promise.all([
    fetchAllRows((from, to) =>
      db
        .from('orders')
        .select('order_id, status, planned_pieces, original_order_date, assigned_time, picker_completed_time, assignment_batch_id, consolidation_batch_id')
        .eq('warehouse_code', warehouseCode)
        .range(from, to),
    ),
    fetchOrderZoneTouches(db, warehouseCode),
    fetchAllRows((from, to) => db.from('assignment_batches').select('assignment_batch_id, picker_id, status, zone_code').eq('warehouse_code', warehouseCode).range(from, to)),
    // Only the count is used below -- a head request returns it via Content-Range without
    // transferring any rows, so it's naturally immune to the row cap rather than needing paging.
    db.from('import_errors').select('error_id', { count: 'exact', head: true }).ilike('error_reason', '%Invalid Bin Code%'),
    getActiveZoneCodes(db, warehouseCode),
  ])

  // order_alerts/picker_completions have no warehouse_code column, so both are fetched via an RPC
  // scoped to exactly this warehouse's order_ids (migration 0022) -- sent in the POST body, not the
  // URL, so it stays correct no matter how many orders this warehouse has, and only transfers rows
  // that are actually relevant instead of the whole table on every page load.
  const orderIds = orders.map((o) => o.order_id)
  const [completions, alerts, thresholds, zonePiecesRows] = await Promise.all([
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
    // Real per-(order, zone) piece quantities (migration 0034) -- an order split across A1/R1
    // must contribute its own line quantity to EACH zone, not its whole planned_pieces repeated in
    // every zone it merely touches (see Zone Status's zoneStatus map below, which used to do
    // exactly that and made the zones' totals add up to more than this page's own Total Pieces).
    fetchScopedByOrderIds<{ order_id: string; zone_code: string; pieces: number }>(db, 'get_order_line_zone_pieces_by_order', 'order_id, zone_code, pieces', orderIds),
  ])
  const completionByOrderId = new Map(completions.map((c) => [c.order_id, c]))
  const statusByOrderId = new Map(orders.map((o) => [o.order_id, o.status]))
  const piecesByOrderZone = new Map<string, Map<string, number>>()
  for (const r of zonePiecesRows) {
    if (!piecesByOrderZone.has(r.order_id)) piecesByOrderZone.set(r.order_id, new Map())
    piecesByOrderZone.get(r.order_id)!.set(r.zone_code, Number(r.pieces))
  }
  const piecesForOrderInZone = (orderId: string, zone: string): number => piecesByOrderZone.get(orderId)?.get(zone) ?? 0

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

  const alertByOrder = new Map(alerts.map((a) => [a.order_id, { ...a, time_alert: computeTimeAlert(statusByOrderId.get(a.order_id) ?? '', a.elapsed_minutes, thresholds) }]))
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
  // Risk level must key off the SAME "which zone(s) is this order really being picked in"
  // definition Zone Dashboard uses: every zone the order's OWN LINES actually touch, not just its
  // assignment batch's single declared zone_code. FR-030's trigger (enforce_assignment_zone_
  // warehouse, migration 0001) only requires that ANY line of the order sits in the batch's zone --
  // it does not require EVERY line to be confined there -- so a single (non-consolidated) batch can
  // legitimately cover an order whose lines span more than one physical zone, same as a
  // consolidation-linked batch (zone_code='MULTI', migration 0027) always could. Previously only
  // the MULTI case was attributed to every touched zone, so a critical/overdue order picked out of
  // two zones under an ordinary batch only ever lit up ONE of those zones' risk badges -- the other
  // zone showed green despite genuinely having that same order running late in it too.
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
  const zoneStatus = zones.map((zone) => {
    const touching = [...(zoneOrders.get(zone) ?? new Set())]
    const closedIds = touching.filter((id) => orderStatusById.get(id)?.startsWith('final_closed'))
    const pickingDoneIds = touching.filter((id) => PICKING_DONE_STATUSES.has(orderStatusById.get(id) ?? ''))
    const totalPieces = touching.reduce((s, id) => s + piecesForOrderInZone(id, zone), 0)
    // Pieces Pending drops as soon as the PICKER submits, not only once Admin verifies -- the
    // physical picking work in this zone is done either way, and waiting on Admin's confirmation
    // shouldn't make the zone still look like it has picking left to do.
    const pendingPieces = touching.filter((id) => !pickingDoneIds.includes(id)).reduce((s, id) => s + piecesForOrderInZone(id, zone), 0)
    const slaPct = touching.length > 0 ? Math.round((closedIds.length / touching.length) * 1000) / 10 : 100
    // Risk level: does this zone have any order still being actively picked THERE that's tripped
    // the 'overdue'/'critical' time alert -- i.e. which zone's pickers are running behind right
    // now. Deliberately NOT based on slaPct above (admin-verification %), which trivially reads as
    // 0 for every zone until Admin starts confirming orders late in the day, regardless of how fast
    // picking itself is going.
    const activeInZone = activeOrderIdsByZone.get(zone) ?? []
    const criticalCount = activeInZone.filter((id) => alertByOrder.get(id)?.time_alert === 'critical').length
    const overdueCount = activeInZone.filter((id) => alertByOrder.get(id)?.time_alert === 'overdue').length
    const riskLevel: 'red' | 'yellow' | 'green' = criticalCount > 0 ? 'red' : overdueCount > 0 ? 'yellow' : 'green'
    return { zone, orders: touching.length, totalPieces, pendingPieces, slaPct, onTrack: slaPct >= 85, riskLevel, criticalCount, overdueCount }
  })

  const batchByAssignmentId = new Map(assignmentBatches.map((b) => [b.assignment_batch_id, b]))
  const orderById = new Map(orders.map((o) => [o.order_id, o]))

  // "Today's" Picker Productivity means exactly that -- only completions actually finished today
  // (Thailand calendar day). An order still being picked has no picker_completions row at all yet
  // (that's only written on submit), so it can never distort this regardless of how long it's been
  // open or whether it crosses midnight into tomorrow; the date filter here is what stops a
  // completion from a PRIOR day still showing up under "today" indefinitely.
  //
  // Same rules as Picker Productivity's own PCS/HR (queries/productivity.ts) -- this widget and
  // that page used to disagree because this loop was never updated when those rules were added
  // there: (1) skip orders linked to a Consolidation Batch, whose cycle time is dominated by
  // however long Sort took, not the picker's own speed; (2) only count an order's cycle time
  // toward the rate if it was also ASSIGNED today, so a multi-day-old order finished today doesn't
  // drag the rate down with a cycle time that has nothing to do with today's work; (3) group by
  // ROUND (assignment_batch_id), not per order -- see computeRoundBasedRate's own comment for why
  // summing each order's own elapsed-since-assignment time double-counts overlapping work the more
  // orders share one round.
  const todayBangkok = bangkokDateKey(new Date())
  const roundRows: RoundCompletion[] = []
  for (const c of completions) {
    if (bangkokDateKey(c.picker_completed_time) !== todayBangkok) continue
    const order = orderById.get(c.order_id)
    if (order?.consolidation_batch_id) continue
    const pickerId = order?.assignment_batch_id ? batchByAssignmentId.get(order.assignment_batch_id)?.picker_id : null
    if (!pickerId || !order?.assigned_time || !order.assignment_batch_id) continue
    if (bangkokDateKey(order.assigned_time) !== todayBangkok) continue
    roundRows.push({ pickerId, assignmentBatchId: order.assignment_batch_id, assignedTime: order.assigned_time, completedTime: c.picker_completed_time, pieces: c.actual_pieces ?? 0 })
  }
  const pickerTotals = computeRoundBasedRate(roundRows)

  // Active pickers right now: which orders are still sitting in an active status (handed to a
  // picker but not yet submitted), broken down per picker for the roster below Zone Status.
  // Active Pickers itself (below) is just this map's size, so the KPI and the roster it explains
  // can never disagree with each other.
  const pickerIdByBatchId = new Map(assignmentBatches.filter((b) => b.picker_id).map((b) => [b.assignment_batch_id, b.picker_id as string]))
  // worstElapsedMinutes/worstAlert track whichever of a picker's active orders has been open
  // longest -- the one that would actually need attention first -- so the roster can show a single
  // status/time per picker instead of forcing the user into a separate per-order drill-down just to
  // see who's actually running late.
  const activePickerWork = new Map<string, { orders: number; pieces: number; worstElapsedMinutes: number; worstAlert: string | null }>()
  for (const o of orders) {
    if (!o.assignment_batch_id) continue
    if (!ACTIVE_ORDER_STATUSES.has(o.status)) continue
    const pickerId = pickerIdByBatchId.get(o.assignment_batch_id)
    if (!pickerId) continue
    const entry = activePickerWork.get(pickerId) ?? { orders: 0, pieces: 0, worstElapsedMinutes: 0, worstAlert: null as string | null }
    entry.orders += 1
    entry.pieces += o.planned_pieces ?? 0
    const orderAlert = alertByOrder.get(o.order_id)
    const elapsed = orderAlert?.elapsed_minutes ?? 0
    if (elapsed >= entry.worstElapsedMinutes) {
      entry.worstElapsedMinutes = elapsed
      entry.worstAlert = orderAlert?.time_alert ?? null
    }
    activePickerWork.set(pickerId, entry)
  }
  const activePickers = activePickerWork.size
  const activePickerTotalPieces = [...activePickerWork.values()].reduce((s, w) => s + w.pieces, 0)
  const activePickerTotalOrders = [...activePickerWork.values()].reduce((s, w) => s + w.orders, 0)

  const pickerIds = [...new Set([...pickerTotals.keys(), ...activePickerWork.keys()])]
  const [pickerNamesRes, employmentTypeRows] = await Promise.all([
    pickerIds.length
      ? db.from('pickers').select('picker_id, name_en, employment_type').in('picker_id', pickerIds)
      : Promise.resolve({ data: [] as { picker_id: string; name_en: string; employment_type: string | null }[] }),
    db.from('picker_employment_types').select('type_code, label_en'),
  ])
  const nameByPickerId = new Map(unwrap(pickerNamesRes).map((p) => [p.picker_id, p.name_en]))
  const employmentTypeByPickerId = new Map(unwrap(pickerNamesRes).map((p) => [p.picker_id, p.employment_type]))
  const employmentTypeLabel = new Map(unwrap(employmentTypeRows).map((t) => [t.type_code, t.label_en]))
  const employmentTypeLabelFor = (pickerId: string): string | null => {
    const code = employmentTypeByPickerId.get(pickerId)
    return code ? employmentTypeLabel.get(code) ?? code : null
  }

  // Same target used by the weekly Picker Productivity rating (migration 0020) -- configurable
  // rather than a hardcoded number baked into the dashboard component.
  const cfg = await getActiveConfig(db, ['picker_productivity.target_pcs_per_hour'])
  const targetPcsPerHour = Number(cfg.value('picker_productivity.target_pcs_per_hour') ?? 4500)

  // Full lists -- both tables paginate/sort client-side now (20/page), so capping here would just
  // hide pickers past the old top-6 cutoff from ever being reachable.
  const pickerProductivity = [...pickerTotals.entries()]
    .map(([pickerId, t]) => {
      const pcsPerHour = Math.round((t.pieces / t.minutes) * 60)
      return {
        pickerId,
        name: nameByPickerId.get(pickerId) ?? pickerId,
        employmentType: employmentTypeLabelFor(pickerId),
        pcsPerHour,
        level: bandForPct((pcsPerHour / targetPcsPerHour) * 100),
      }
    })
    .sort((a, b) => b.pcsPerHour - a.pcsPerHour)

  const activePickerRoster = [...activePickerWork.entries()]
    .map(([pickerId, w]) => ({
      pickerId,
      name: nameByPickerId.get(pickerId) ?? pickerId,
      employmentType: employmentTypeLabelFor(pickerId),
      orders: w.orders,
      pieces: w.pieces,
      elapsedMinutes: Math.round(w.worstElapsedMinutes),
      timeAlert: w.worstAlert as 'warning' | 'overdue' | 'critical' | null,
    }))
    .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes)

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
    backlogByDate,
    statusCounts: Object.fromEntries(statusCounts),
    zoneStatus,
    pickerProductivity,
    targetPcsPerHour,
    activePickerRoster,
    actionRequired: {
      critical,
      overdue,
      waitingVerification: waitingVerifyOrders,
      correctionInProgress: (statusCounts.get('admin_rejected') ?? 0) + (statusCounts.get('correction_in_progress') ?? 0),
      invalidBinCode: invalidBinCount.count ?? 0,
    },
  }
}
