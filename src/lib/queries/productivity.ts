import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

const WINDOW_DAYS = 7
/** Cycle time (Assigned → Picker Completed) at or under this is "on time" for the SLA KPI here.
 * Matches Control Tower's "overdue" threshold (§13); a dedicated configuration key is a
 * reasonable follow-up, not built here (same judgment call as order_alerts' thresholds). */
const SLA_THRESHOLD_MINUTES = 120

/** §12.2/§13 Productivity / SLA / Short Pick analytics — 7-day picker productivity, cycle-time
 * SLA compliance, and a short-pick reason breakdown (which reasons cost the most pieces). */
export async function getProductivityData(db: SupabaseClient, warehouseCode: string) {
  const sinceIso = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const [completionsRes, ordersRes, pickersRes] = await Promise.all([
    db.from('picker_completions').select('completion_id, order_id, actual_pieces, result, picker_completed_time').gte('picker_completed_time', sinceIso),
    db.from('orders').select('order_id, assigned_time, assignment_batch_id, warehouse_code').eq('warehouse_code', warehouseCode),
    db.from('employees_users').select('user_id, name_en').eq('warehouse_code', warehouseCode).eq('role', 'picker').eq('active', true),
  ])
  const orders = unwrap(ordersRes)
  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const completions = unwrap(completionsRes).filter((c) => orderById.has(c.order_id))
  const pickers = unwrap(pickersRes)

  const batchIds = [...new Set(completions.map((c) => orderById.get(c.order_id)?.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))

  const productivityByPicker = new Map<string, { pieces: number; minutes: number; completed: number; short: number; onTime: number }>()
  let totalPieces = 0
  let totalMinutes = 0
  let onTimeCount = 0
  let cycleTimedCount = 0

  for (const c of completions) {
    const order = orderById.get(c.order_id)
    const pickerId = order?.assignment_batch_id ? pickerIdByBatch.get(order.assignment_batch_id) : null
    totalPieces += c.actual_pieces ?? 0
    if (!order?.assigned_time) continue
    const minutes = Math.max(1, (new Date(c.picker_completed_time).getTime() - new Date(order.assigned_time).getTime()) / 60000)
    totalMinutes += minutes
    cycleTimedCount += 1
    const onTime = minutes <= SLA_THRESHOLD_MINUTES
    if (onTime) onTimeCount += 1
    if (!pickerId) continue
    const entry = productivityByPicker.get(pickerId) ?? { pieces: 0, minutes: 0, completed: 0, short: 0, onTime: 0 }
    entry.pieces += c.actual_pieces ?? 0
    entry.minutes += minutes
    entry.completed += 1
    if (c.result === 'short') entry.short += 1
    if (onTime) entry.onTime += 1
    productivityByPicker.set(pickerId, entry)
  }

  const pickerRows = pickers
    .map((p) => {
      const e = productivityByPicker.get(p.user_id)
      return {
        user_id: p.user_id,
        name: p.name_en,
        pcsPerHour: e && e.minutes > 0 ? Math.round((e.pieces / e.minutes) * 60) : null,
        completed: e?.completed ?? 0,
        shortRate: e && e.completed > 0 ? Math.round((e.short / e.completed) * 1000) / 10 : null,
        slaPct: e && e.completed > 0 ? Math.round((e.onTime / e.completed) * 1000) / 10 : null,
      }
    })
    .sort((a, b) => (b.pcsPerHour ?? -1) - (a.pcsPerHour ?? -1))

  const completionIds = completions.map((c) => c.completion_id)
  const shortLinesRes = completionIds.length
    ? await db.from('picker_completion_lines').select('short_reason_code, ordered_qty, picked_qty').in('completion_id', completionIds).eq('is_short', true)
    : { data: [] as { short_reason_code: string | null; ordered_qty: number; picked_qty: number }[] }
  const shortLines = unwrap(shortLinesRes)

  const reasonsRes = await db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick')
  const labelByReason = new Map(unwrap(reasonsRes).map((r) => [r.reason_code, r.label_en]))

  const reasonTotals = new Map<string, { count: number; shortPieces: number }>()
  for (const l of shortLines) {
    const code = l.short_reason_code ?? 'UNKNOWN'
    const entry = reasonTotals.get(code) ?? { count: 0, shortPieces: 0 }
    entry.count += 1
    entry.shortPieces += Number(l.ordered_qty) - Number(l.picked_qty)
    reasonTotals.set(code, entry)
  }
  const reasonBreakdown = [...reasonTotals.entries()]
    .map(([code, t]) => ({ code, label: labelByReason.get(code) ?? code, count: t.count, shortPieces: t.shortPieces }))
    .sort((a, b) => b.shortPieces - a.shortPieces)

  const shortCount = completions.filter((c) => c.result === 'short').length

  return {
    windowDays: WINDOW_DAYS,
    pickerRows,
    reasonBreakdown,
    kpis: {
      completedOrders: completions.length,
      totalPieces,
      avgPcsPerHour: totalMinutes > 0 ? Math.round((totalPieces / totalMinutes) * 60) : null,
      slaPct: cycleTimedCount > 0 ? Math.round((onTimeCount / cycleTimedCount) * 1000) / 10 : null,
      shortRatePct: completions.length > 0 ? Math.round((shortCount / completions.length) * 1000) / 10 : null,
    },
  }
}
