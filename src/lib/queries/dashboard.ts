import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'

// Any select scoped only by warehouse_code/status (no further narrowing) needs an explicit high
// limit — Supabase/PostgREST caps an unbounded select at 1000 rows by default, which silently
// truncated these once real order volume passed that (confirmed root cause of Dashboard/Zone
// Dashboard/Control Tower all under-reporting after a real import).
const ROW_CAP = 200000

/**
 * Aggregates computed in JS after small raw-row fetches, not SQL views — fine at dev/demo scale.
 * At the §19 design capacity (5,000 orders/day) these should move into SQL views or an RPC
 * function; flagged rather than silently left as a scaling trap.
 */
export async function getDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [ordersRes, linesRes, assignmentBatchesRes, importErrorsRes, zones] = await Promise.all([
    db.from('orders').select('order_id, status, planned_pieces, assigned_time, picker_completed_time, assignment_batch_id').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
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

  const totalOrders = orders.length
  const totalPlannedPieces = orders.reduce((s, o) => s + (o.planned_pieces ?? 0), 0)
  const piecesPicked = completions.reduce((s, c) => s + (c.actual_pieces ?? 0), 0)
  const pickerCompletedCount = completions.length
  const pickerCompleted100 = completions.filter((c) => c.result === '100_percent').length
  const pickerCompletedShort = completions.filter((c) => c.result === 'short').length

  const alertByOrder = new Map(alerts.map((a) => [a.order_id, a]))
  const pickingBacklog = orders.filter((o) => alertByOrder.get(o.order_id)?.is_picking_backlog).length
  const verificationBacklog = orders.filter((o) => alertByOrder.get(o.order_id)?.is_verification_backlog).length
  const critical = orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'critical').length
  const overdue = orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'overdue').length

  const activePickers = new Set(assignmentBatches.filter((b) => b.status === 'in_progress').map((b) => b.picker_id)).size

  const statusCounts = new Map<string, number>()
  for (const o of orders) statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1)

  const zoneOrders = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrders.has(l.zone_code)) zoneOrders.set(l.zone_code, new Set())
    zoneOrders.get(l.zone_code)!.add(l.order_id)
  }

  const orderStatusById = new Map(orders.map((o) => [o.order_id, o.status]))
  const zoneStatus = zones.map((zone) => {
    const touching = zoneOrders.get(zone) ?? new Set()
    const closed = [...touching].filter((id) => orderStatusById.get(id)?.startsWith('final_closed')).length
    const slaPct = touching.size > 0 ? Math.round((closed / touching.size) * 1000) / 10 : 100
    return { zone: `Zone ${zone}`, orders: touching.size, slaPct, onTrack: slaPct >= 85 }
  })

  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const batchByAssignmentId = new Map(assignmentBatches.map((b) => [b.assignment_batch_id, b]))

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
  const pickerIds = [...pickerTotals.keys()]
  const pickerNamesRes = pickerIds.length
    ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds)
    : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPickerId = new Map(unwrap(pickerNamesRes).map((p) => [p.user_id, p.name_en]))

  const pickerProductivity = [...pickerTotals.entries()]
    .map(([pickerId, t]) => ({ pickerId, name: nameByPickerId.get(pickerId) ?? pickerId, pcsPerHour: Math.round((t.pieces / t.minutes) * 60) }))
    .sort((a, b) => b.pcsPerHour - a.pcsPerHour)
    .slice(0, 6)

  return {
    kpis: {
      totalOrders,
      totalPlannedPieces,
      piecesPicked,
      pickerCompletedCount,
      pickerCompleted100,
      pickerCompletedShort,
      pickingBacklog,
      verificationBacklog,
      activePickers,
    },
    statusCounts: Object.fromEntries(statusCounts),
    zoneStatus,
    pickerProductivity,
    actionRequired: {
      critical,
      overdue,
      waitingVerification: statusCounts.get('waiting_admin_verification') ?? 0,
      invalidBinCode: invalidBinErrors.length,
    },
    flow: {
      importOrders: totalOrders,
      assignment: (statusCounts.get('assigned') ?? 0) + (statusCounts.get('in_progress') ?? 0),
    },
  }
}
