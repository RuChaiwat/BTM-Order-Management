import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export async function getVerificationData(db: SupabaseClient, warehouseCode: string) {
  const waitingRes = await db
    .from('orders')
    .select('order_id, order_no, store_code, original_order_date, planned_pieces, status, assignment_batch_id')
    .eq('warehouse_code', warehouseCode)
    .in('status', ['picker_completed_100', 'picker_completed_short'])
  const waitingOrders = unwrap(waitingRes)

  const orderIds = waitingOrders.map((o) => o.order_id)
  const completionsRes = orderIds.length
    ? await db.from('picker_completions').select('completion_id, order_id, actual_pieces, result, picker_completed_time, remark, short_reason_code').in('order_id', orderIds)
    : { data: [] as { completion_id: string; order_id: string; actual_pieces: number; result: string; picker_completed_time: string; remark: string | null; short_reason_code: string | null }[] }
  const completions = unwrap(completionsRes)
  const completionByOrder = new Map(completions.map((c) => [c.order_id, c]))

  const completionIds = completions.map((c) => c.completion_id)
  const shortLinesRes = completionIds.length
    ? await db.from('picker_completion_lines').select('completion_id, line_id, ordered_qty, picked_qty, short_reason_code, remark').in('completion_id', completionIds).eq('is_short', true)
    : { data: [] as { completion_id: string; line_id: string; ordered_qty: number; picked_qty: number; short_reason_code: string | null; remark: string | null }[] }
  const shortLineRows = unwrap(shortLinesRes)

  const shortLineIds = shortLineRows.map((l) => l.line_id)
  const orderLinesRes = shortLineIds.length
    ? await db.from('order_lines').select('line_id, sku, item_description').in('line_id', shortLineIds)
    : { data: [] as { line_id: string; sku: string; item_description: string | null }[] }
  const orderLineById = new Map(unwrap(orderLinesRes).map((l) => [l.line_id, l]))

  const shortLinesByCompletion = new Map<string, (typeof shortLineRows[number] & { sku: string; item_description: string | null })[]>()
  for (const l of shortLineRows) {
    const detail = orderLineById.get(l.line_id)
    const arr = shortLinesByCompletion.get(l.completion_id) ?? []
    arr.push({ ...l, sku: detail?.sku ?? l.line_id, item_description: detail?.item_description ?? null })
    shortLinesByCompletion.set(l.completion_id, arr)
  }

  const batchIds = [...new Set(waitingOrders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id, assigned_time').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null; assigned_time: string | null }[] }
  const batchById = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b]))

  const pickerIds = [...new Set(unwrap(batchesRes).map((b) => b.picker_id).filter(Boolean))] as string[]
  const pickersRes = pickerIds.length
    ? await db.from('employees_users').select('user_id, name_en').in('user_id', pickerIds)
    : { data: [] as { user_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.user_id, p.name_en]))

  const queue = waitingOrders
    .map((o) => {
      const completion = completionByOrder.get(o.order_id)
      const batch = o.assignment_batch_id ? batchById.get(o.assignment_batch_id) : null
      return {
        ...o,
        completion,
        shortLines: completion ? shortLinesByCompletion.get(completion.completion_id) ?? [] : [],
        pickerName: batch?.picker_id ? nameByPicker.get(batch.picker_id) ?? batch.picker_id : '—',
        waitMinutes: completion ? Math.round((Date.now() - new Date(completion.picker_completed_time).getTime()) / 60000) : 0,
      }
    })
    .sort((a, b) => (a.completion?.picker_completed_time ?? '').localeCompare(b.completion?.picker_completed_time ?? ''))

  return { queue }
}
