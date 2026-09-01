import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

// See dashboard.ts — unbounded selects silently truncate at Supabase's default 1000-row cap.
const ROW_CAP = 200000

/** §13 Backlog Monitor — orders flagged by order_alerts as Picking Backlog (still open past
 * original_order_date) or Verification Backlog (picker done, waiting on Admin), sorted by how
 * long they've been sitting. */
export async function getBacklogData(db: SupabaseClient, warehouseCode: string) {
  const [ordersRes, linesRes] = await Promise.all([
    db
      .from('orders')
      .select('order_id, order_no, store_code, status, original_order_date, planned_pieces, assignment_batch_id')
      .eq('warehouse_code', warehouseCode)
      .limit(ROW_CAP),
    db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
  ])
  if (ordersRes.error) console.error('[backlog] orders error', ordersRes.error.message)
  if (linesRes.error) console.error('[backlog] order_lines error', linesRes.error.message)
  const orders = unwrap(ordersRes)
  const lines = unwrap(linesRes)

  // order_alerts has no warehouse_code column — scope it via this warehouse's own order_ids
  // rather than fetching every warehouse's alerts unfiltered (part of the original truncation bug).
  const orderIds = orders.map((o) => o.order_id)
  const alertsRes = orderIds.length
    ? await db.from('order_alerts').select('order_id, time_alert, elapsed_minutes, is_picking_backlog, is_verification_backlog').in('order_id', orderIds).limit(ROW_CAP)
    : { data: [] as { order_id: string; time_alert: string | null; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }[], error: null }
  const alertByOrder = new Map(unwrap(alertsRes).map((a) => [a.order_id, a]))

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
