import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

/** §13 Backlog Monitor — orders flagged by order_alerts as Picking Backlog (still open past
 * original_order_date) or Verification Backlog (picker done, waiting on Admin), sorted by how
 * long they've been sitting. */
export async function getBacklogData(db: SupabaseClient, warehouseCode: string) {
  const [ordersRes, alertsRes, linesRes] = await Promise.all([
    db
      .from('orders')
      .select('order_id, order_no, store_code, status, original_order_date, planned_pieces, assignment_batch_id')
      .eq('warehouse_code', warehouseCode),
    db.from('order_alerts').select('order_id, time_alert, elapsed_minutes, is_picking_backlog, is_verification_backlog'),
    db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode),
  ])
  const orders = unwrap(ordersRes)
  const alerts = unwrap(alertsRes)
  const lines = unwrap(linesRes)
  const alertByOrder = new Map(alerts.map((a) => [a.order_id, a]))

  const zonesByOrder = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
    zonesByOrder.get(l.order_id)!.add(l.zone_code)
  }

  const backlogOrders = orders
    .map((o) => ({ ...o, alert: alertByOrder.get(o.order_id), zones: [...(zonesByOrder.get(o.order_id) ?? new Set())] }))
    .filter((o) => o.alert?.is_picking_backlog || o.alert?.is_verification_backlog)

  const batchIds = [...new Set(backlogOrders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))
  const pickerIds = [...new Set([...pickerIdByBatch.values()].filter(Boolean))] as string[]
  const pickersRes = pickerIds.length ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds) : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.user_id, p.name_en]))

  const rows = backlogOrders
    .map((o) => {
      const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
      const backlogType: 'picking' | 'verification' | 'both' =
        o.alert?.is_picking_backlog && o.alert?.is_verification_backlog ? 'both' : o.alert?.is_picking_backlog ? 'picking' : 'verification'
      return { ...o, pickerName: pickerId ? nameByPicker.get(pickerId) ?? pickerId : '—', backlogType }
    })
    .sort((a, b) => (b.alert?.elapsed_minutes ?? 0) - (a.alert?.elapsed_minutes ?? 0))

  return {
    rows,
    summary: {
      pickingBacklog: rows.filter((r) => r.alert?.is_picking_backlog).length,
      verificationBacklog: rows.filter((r) => r.alert?.is_verification_backlog).length,
      critical: rows.filter((r) => r.alert?.time_alert === 'critical').length,
      overdue: rows.filter((r) => r.alert?.time_alert === 'overdue').length,
    },
  }
}
