import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export async function getVerificationData(db: SupabaseClient, warehouseCode: string) {
  const [waitingRes, activeRes, reasonsRes] = await Promise.all([
    db
      .from('orders')
      .select('order_id, order_no, store_code, original_order_date, planned_pieces, status, assignment_batch_id')
      .eq('warehouse_code', warehouseCode)
      .in('status', ['picker_completed_100', 'picker_completed_short']),
    db
      .from('orders')
      .select('order_id, order_no, planned_pieces, status, assignment_batch_id')
      .eq('warehouse_code', warehouseCode)
      .in('status', ['assigned', 'in_progress']),
    db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick').eq('active', true),
  ])
  const waitingOrders = unwrap(waitingRes)
  const activeOrders = unwrap(activeRes)
  const reasons = unwrap(reasonsRes)

  const orderIds = waitingOrders.map((o) => o.order_id)
  const completionsRes = orderIds.length
    ? await db.from('picker_completions').select('order_id, actual_pieces, result, picker_completed_time, remark, short_reason_code').in('order_id', orderIds)
    : { data: [] as { order_id: string; actual_pieces: number; result: string; picker_completed_time: string; remark: string | null; short_reason_code: string | null }[] }
  const completionByOrder = new Map(unwrap(completionsRes).map((c) => [c.order_id, c]))

  const batchIds = [...new Set([...waitingOrders, ...activeOrders].map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id, assigned_time').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null; assigned_time: string | null }[] }
  const batchById = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b]))

  const pickerIds = [...new Set(unwrap(batchesRes).map((b) => b.picker_id).filter(Boolean))] as string[]
  const pickersRes = pickerIds.length
    ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds)
    : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.user_id, p.name_en]))

  const queue = waitingOrders.map((o) => {
    const completion = completionByOrder.get(o.order_id)
    const batch = o.assignment_batch_id ? batchById.get(o.assignment_batch_id) : null
    return {
      ...o,
      completion,
      pickerName: batch?.picker_id ? nameByPicker.get(batch.picker_id) ?? batch.picker_id : '—',
      waitMinutes: completion ? Math.round((Date.now() - new Date(completion.picker_completed_time).getTime()) / 60000) : 0,
    }
  })

  const active = activeOrders.map((o) => {
    const batch = o.assignment_batch_id ? batchById.get(o.assignment_batch_id) : null
    return { ...o, pickerName: batch?.picker_id ? nameByPicker.get(batch.picker_id) ?? batch.picker_id : '—' }
  })

  return { queue, active, shortPickReasons: reasons }
}
