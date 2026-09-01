import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { getActiveZoneCodes } from './locations'

// See dashboard.ts — unbounded selects silently truncate at Supabase's default 1000-row cap.
const ROW_CAP = 200000

/** §12/§13 Zone Dashboard — a zone-level drill-down of Control Tower's zone overview: which
 * orders touch each zone, who is actively picking there, and each zone's backlog/SLA. */
export async function getZoneDashboardData(db: SupabaseClient, warehouseCode: string) {
  const [linesRes, ordersRes, batchesRes, zones] = await Promise.all([
    db.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
    db.from('orders').select('order_id, order_no, status, assignment_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
    db.from('assignment_batches').select('assignment_batch_id, picker_id, zone_code, status').eq('warehouse_code', warehouseCode).limit(ROW_CAP),
    getActiveZoneCodes(db, warehouseCode),
  ])
  if (linesRes.error) console.error('[zoneDashboard] order_lines error', linesRes.error.message)
  if (ordersRes.error) console.error('[zoneDashboard] orders error', ordersRes.error.message)
  if (batchesRes.error) console.error('[zoneDashboard] assignment_batches error', batchesRes.error.message)

  const lines = unwrap(linesRes)
  const orders = unwrap(ordersRes)
  const batches = unwrap(batchesRes)
  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const pickerIdByBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))

  // order_alerts has no warehouse_code column — scope it via this warehouse's own order_ids
  // rather than fetching every warehouse's alerts unfiltered (part of the original truncation bug).
  const orderIds = orders.map((o) => o.order_id)
  const alertsRes = orderIds.length
    ? await db.from('order_alerts').select('order_id, time_alert, elapsed_minutes, is_picking_backlog, is_verification_backlog').in('order_id', orderIds).limit(ROW_CAP)
    : { data: [] as { order_id: string; time_alert: string | null; elapsed_minutes: number; is_picking_backlog: boolean; is_verification_backlog: boolean }[], error: null }
  const alertByOrder = new Map(unwrap(alertsRes).map((a) => [a.order_id, a]))

  const pickerIds = [...new Set(batches.map((b) => b.picker_id).filter(Boolean))] as string[]
  const pickersRes = pickerIds.length ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds) : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.user_id, p.name_en]))

  const zoneOrderIds = new Map<string, Set<string>>()
  for (const l of lines) {
    if (!l.zone_code) continue
    if (!zoneOrderIds.has(l.zone_code)) zoneOrderIds.set(l.zone_code, new Set())
    zoneOrderIds.get(l.zone_code)!.add(l.order_id)
  }

  const pickersByZone = new Map<string, Set<string>>()
  for (const b of batches) {
    if (!b.zone_code || !b.picker_id || !['assigned', 'in_progress'].includes(b.status)) continue
    if (!pickersByZone.has(b.zone_code)) pickersByZone.set(b.zone_code, new Set())
    pickersByZone.get(b.zone_code)!.add(b.picker_id)
  }

  const zoneDetail = zones.map((zone) => {
    const touching = [...(zoneOrderIds.get(zone) ?? new Set())]
      .map((id) => orderById.get(id))
      .filter((o): o is NonNullable<typeof o> => Boolean(o))
      .map((o) => {
        const alert = alertByOrder.get(o.order_id)
        const pickerId = o.assignment_batch_id ? pickerIdByBatch.get(o.assignment_batch_id) : null
        return { ...o, alert, pickerName: pickerId ? nameByPicker.get(pickerId) ?? pickerId : '—' }
      })
      .sort((a, b) => (b.alert?.elapsed_minutes ?? 0) - (a.alert?.elapsed_minutes ?? 0))

    const completed = touching.filter((o) => o.status?.startsWith('final_closed')).length
    const slaPct = touching.length > 0 ? Math.round((completed / touching.length) * 1000) / 10 : 100

    return {
      zone,
      orders: touching,
      activePickers: pickersByZone.get(zone)?.size ?? 0,
      assigned: touching.filter((o) => o.status === 'assigned').length,
      inProgress: touching.filter((o) => o.status === 'in_progress').length,
      completed,
      pickingBacklog: touching.filter((o) => o.alert?.is_picking_backlog).length,
      verificationBacklog: touching.filter((o) => o.alert?.is_verification_backlog).length,
      critical: touching.filter((o) => o.alert?.time_alert === 'critical').length,
      overdue: touching.filter((o) => o.alert?.time_alert === 'overdue').length,
      plannedPieces: touching.reduce((s, o) => s + (o.planned_pieces ?? 0), 0),
      slaPct,
    }
  })

  return { zoneDetail }
}
