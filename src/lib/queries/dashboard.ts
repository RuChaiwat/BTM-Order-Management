import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

const ZONES = ['A', 'B', 'C', 'D', 'E']

/**
 * Aggregates computed in JS after small raw-row fetches, not SQL views — fine at dev/demo scale.
 * At the §19 design capacity (5,000 orders/day) these should move into SQL views or an RPC
 * function; flagged rather than silently left as a scaling trap.
 */
export async function getDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [ordersRes, linesRes, assignmentBatchesRes, alertsRes, importErrorsRes] = await Promise.all([
    db.from('orders').select('order_id, status, planned_pieces, assigned_time, picker_completed_time, assignment_batch_id').eq('warehouse_code', warehouseCode),
    db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode),
    db.from('assignment_batches').select('assignment_batch_id, picker_id, status, zone_code').eq('warehouse_code', warehouseCode),
    db.from('order_alerts').select('order_id, time_alert, is_picking_backlog, is_verification_backlog'),
    db.from('import_errors').select('error_id, error_reason').ilike('error_reason', '%Invalid Bin Code%'),
  ])

  const orders = ordersRes.data ?? []
  const lines = linesRes.data ?? []
  const assignmentBatches = assignmentBatchesRes.data ?? []
  const alerts = alertsRes.data ?? []
  const invalidBinErrors = importErrorsRes.data ?? []

  const orderIds = orders.map((o) => o.order_id)
  const completionsRes = orderIds.length
    ? await db.from('picker_completions').select('order_id, actual_pieces, picker_completed_time, result').in('order_id', orderIds)
    : { data: [] as { order_id: string; actual_pieces: number; picker_completed_time: string; result: string }[] }
  const completions = completionsRes.data ?? []

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
  const zoneStatus = ZONES.map((zone) => {
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
