import type { SupabaseClient } from '@supabase/supabase-js'
import { getDashboardData } from './dashboard'
import { unwrap } from './unwrap'

const ZONES = ['A', 'B', 'C', 'D', 'E']

export async function getControlTowerData(db: SupabaseClient, warehouseCode: string) {
  const base = await getDashboardData(db, warehouseCode)

  const [ordersRes, linesRes, alertsRes] = await Promise.all([
    db.from('orders').select('order_id, order_no, status, assigned_time, warehouse_code, assignment_batch_id').eq('warehouse_code', warehouseCode),
    db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode),
    db.from('order_alerts').select('order_id, time_alert, elapsed_minutes, is_picking_backlog, is_verification_backlog'),
  ])
  const orders = unwrap(ordersRes)
  const lines = unwrap(linesRes)
  const alertByOrder = new Map(unwrap(alertsRes).map((a) => [a.order_id, a]))
  const orderStatusById = new Map(orders.map((o) => [o.order_id, o.status]))

  const zoneOrders = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrders.has(l.zone_code)) zoneOrders.set(l.zone_code, new Set())
    zoneOrders.get(l.zone_code)!.add(l.order_id)
  }

  const zoneOverview = ZONES.map((zone) => {
    const touching = [...(zoneOrders.get(zone) ?? new Set())]
    const inProgress = touching.filter((id) => orderStatusById.get(id) === 'in_progress').length
    const completed = touching.filter((id) => orderStatusById.get(id)?.startsWith('final_closed')).length
    const pickingBacklog = touching.filter((id) => alertByOrder.get(id)?.is_picking_backlog).length
    const verificationBacklog = touching.filter((id) => alertByOrder.get(id)?.is_verification_backlog).length
    const slaPct = touching.length > 0 ? Math.round((completed / touching.length) * 1000) / 10 : 100
    return { zone, orders: touching.length, pickingBacklog, verificationBacklog, inProgress, completed, slaPct }
  })

  const overdueOrdersRaw = orders
    .map((o) => ({ ...o, alert: alertByOrder.get(o.order_id) }))
    .filter((o) => o.alert?.time_alert === 'critical' || o.alert?.time_alert === 'overdue')
    .sort((a, b) => (b.alert?.elapsed_minutes ?? 0) - (a.alert?.elapsed_minutes ?? 0))
    .slice(0, 6)

  const batchIds = [...new Set(overdueOrdersRaw.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))
  const pickerIds = [...new Set([...pickerIdByBatch.values()].filter(Boolean))] as string[]
  const pickersRes = pickerIds.length
    ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds)
    : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPickerId = new Map(unwrap(pickersRes).map((p) => [p.user_id, p.name_en]))

  const overdueOrders = overdueOrdersRaw.map((o) => {
    const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
    return { ...o, pickerName: pickerId ? nameByPickerId.get(pickerId) ?? pickerId : '—' }
  })

  return {
    ...base,
    zoneOverview,
    topOverdueOrders: overdueOrders,
    secondaryKpis: {
      warningOrders: orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'warning').length,
      overdueOrders: orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'overdue').length,
      criticalOrders: orders.filter((o) => alertByOrder.get(o.order_id)?.time_alert === 'critical').length,
    },
  }
}
