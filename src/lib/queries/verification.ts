import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { fetchScopedByOrderIds } from './scopedFetch'

export interface VerificationLine {
  line_id: string
  sku: string
  sku_barcode: string | null
  item_description: string | null
  bin_code: string
  qty: number
  uom_code: string | null
}

/**
 * Admin Verification redesign: the picker only reported a coarse result (§12.2), so the per-line
 * short quantity/reason no longer exists yet when an order lands in this queue -- Admin enters it
 * here, against the real WMS confirmation. Every line on every waiting order is fetched fresh from
 * order_lines (not picker_completion_lines, which is now Admin's own write target, not a read
 * source) so the verification screen always starts from the actual order, not from anything the
 * picker guessed at.
 */
export async function getVerificationData(db: SupabaseClient, warehouseCode: string) {
  const waitingRes = await db
    .from('orders')
    .select('order_id, order_no, store_code, original_order_date, planned_pieces, status, assignment_batch_id')
    .eq('warehouse_code', warehouseCode)
    .in('status', ['picker_completed_100', 'picker_completed_short'])
  const waitingOrders = unwrap(waitingRes)

  // picker_completions has no warehouse_code column, so it's fetched via an RPC scoped to exactly
  // this queue's order_ids (migration 0022) instead of the whole table.
  const completions = await fetchScopedByOrderIds<{ completion_id: string; order_id: string; actual_pieces: number | null; result: string; picker_completed_time: string }>(
    db,
    'get_picker_completions_by_ids',
    'completion_id, order_id, actual_pieces, result, picker_completed_time',
    waitingOrders.map((o) => o.order_id),
  )
  const completionByOrder = new Map(completions.map((c) => [c.order_id, c]))

  const orderIds = waitingOrders.map((o) => o.order_id)
  const linesRes = orderIds.length
    ? await db.from('order_lines').select('line_id, order_id, sku, sku_barcode, item_description, bin_code, qty, uom_code').in('order_id', orderIds)
    : { data: [] as (VerificationLine & { order_id: string })[] }
  const linesByOrder = new Map<string, VerificationLine[]>()
  for (const l of unwrap(linesRes)) {
    const arr = linesByOrder.get(l.order_id) ?? []
    arr.push({ line_id: l.line_id, sku: l.sku, sku_barcode: l.sku_barcode, item_description: l.item_description, bin_code: l.bin_code, qty: l.qty, uom_code: l.uom_code })
    linesByOrder.set(l.order_id, arr)
  }

  const reasonsRes = await db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick').eq('active', true)
  const shortPickReasons = unwrap(reasonsRes)

  const batchIds = [...new Set(waitingOrders.map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id, assigned_time').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null; assigned_time: string | null }[] }
  const batchById = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b]))

  const pickerIds = [...new Set(unwrap(batchesRes).map((b) => b.picker_id).filter(Boolean))] as string[]
  const pickersRes = pickerIds.length
    ? await db.from('pickers').select('picker_id, name_en').in('picker_id', pickerIds)
    : { data: [] as { picker_id: string; name_en: string }[] }
  const nameByPicker = new Map(unwrap(pickersRes).map((p) => [p.picker_id, p.name_en]))

  const queue = waitingOrders
    .map((o) => {
      const completion = completionByOrder.get(o.order_id)
      const batch = o.assignment_batch_id ? batchById.get(o.assignment_batch_id) : null
      return {
        ...o,
        completion,
        pickerName: batch?.picker_id ? nameByPicker.get(batch.picker_id) ?? batch.picker_id : '—',
        waitMinutes: completion ? Math.round((Date.now() - new Date(completion.picker_completed_time).getTime()) / 60000) : 0,
      }
    })
    .sort((a, b) => (a.completion?.picker_completed_time ?? '').localeCompare(b.completion?.picker_completed_time ?? ''))

  return { queue, linesByOrder: Object.fromEntries(linesByOrder), shortPickReasons }
}
