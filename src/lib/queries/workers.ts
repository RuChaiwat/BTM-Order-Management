import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export async function getWorkerData(db: SupabaseClient, warehouseCode: string) {
  const usersRes = await db
    .from('employees_users')
    .select('user_id, name_en, name_th, email, role, warehouse_code, zone_scope, active, shift_label, created_at')
    .eq('warehouse_code', warehouseCode)
    .order('user_id')
  const users = unwrap(usersRes)

  const pickerIds = users.filter((u) => u.role === 'picker').map((u) => u.user_id)

  // 7-day pcs/hr per picker, derived the same way as dashboard productivity but windowed.
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const recentCompletionsRes = pickerIds.length
    ? await db.from('picker_completions').select('order_id, actual_pieces, picker_completed_time, result').gte('picker_completed_time', sevenDaysAgo)
    : { data: [] as { order_id: string; actual_pieces: number; picker_completed_time: string; result: string }[] }
  const recentCompletions = unwrap(recentCompletionsRes)

  const completionOrderIds = recentCompletions.map((c) => c.order_id)
  const relatedOrdersRes = completionOrderIds.length
    ? await db.from('orders').select('order_id, assigned_time, assignment_batch_id').in('order_id', completionOrderIds)
    : { data: [] as { order_id: string; assigned_time: string | null; assignment_batch_id: string | null }[] }
  const relatedOrders = unwrap(relatedOrdersRes)
  const orderById = new Map(relatedOrders.map((o) => [o.order_id, o]))

  const batchIds = [...new Set(relatedOrders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const batches = unwrap(batchesRes)
  const pickerByBatch = new Map(batches.map((b) => [b.assignment_batch_id, b.picker_id]))

  const productivityByPicker = new Map<string, { pieces: number; minutes: number; completed: number; short: number }>()
  for (const c of recentCompletions) {
    const order = orderById.get(c.order_id)
    const pickerId = order?.assignment_batch_id ? pickerByBatch.get(order.assignment_batch_id) : null
    if (!pickerId || !order?.assigned_time) continue
    const minutes = Math.max(1, (new Date(c.picker_completed_time).getTime() - new Date(order.assigned_time).getTime()) / 60000)
    const entry = productivityByPicker.get(pickerId) ?? { pieces: 0, minutes: 0, completed: 0, short: 0 }
    entry.pieces += c.actual_pieces ?? 0
    entry.minutes += minutes
    entry.completed += 1
    if (c.result === 'short') entry.short += 1
    productivityByPicker.set(pickerId, entry)
  }

  const usersWithProductivity = users.map((u) => {
    const p = productivityByPicker.get(u.user_id)
    return {
      ...u,
      pcsPerHour: p ? Math.round((p.pieces / p.minutes) * 60) : null,
      completedCount: p?.completed ?? 0,
      shortPickRate: p && p.completed > 0 ? Math.round((p.short / p.completed) * 1000) / 10 : null,
    }
  })

  return { users: usersWithProductivity }
}
