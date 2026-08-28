import type { SupabaseClient } from '@supabase/supabase-js'
import type { AppUser } from '../auth'
import { unwrap } from './unwrap'

/** Orders + lines available for the picker's own Pick Completion screen (§12.2 flow:
 * scan order → show all lines → mark short items → reason + qty → confirm). Pickers only see
 * orders on their own active Assignment Batches; office roles see the whole warehouse queue
 * (useful for support/testing, but the API still enforces the real scoping on write). */
export async function getPickCompletionData(db: SupabaseClient, warehouseCode: string, user: AppUser) {
  const ordersRes = await db
    .from('orders')
    .select('order_id, order_no, store_code, planned_pieces, status, assignment_batch_id, assigned_time')
    .eq('warehouse_code', warehouseCode)
    .in('status', ['assigned', 'in_progress', 'correction_in_progress'])
  let orders = unwrap(ordersRes)

  if (user.role === 'picker') {
    const batchesRes = await db.from('assignment_batches').select('assignment_batch_id').eq('picker_id', user.user_id)
    const myBatchIds = new Set(unwrap(batchesRes).map((b) => b.assignment_batch_id))
    orders = orders.filter((o) => o.assignment_batch_id && myBatchIds.has(o.assignment_batch_id))
  }

  const orderIds = orders.map((o) => o.order_id)
  const linesRes = orderIds.length
    ? await db.from('order_lines').select('line_id, order_id, sku, item_description, bin_code, qty, uom_code, zone_code, pick_sequence').in('order_id', orderIds)
    : { data: [] as { line_id: string; order_id: string; sku: string; item_description: string | null; bin_code: string; qty: number; uom_code: string | null; zone_code: string | null; pick_sequence: string | null }[] }
  const lines = unwrap(linesRes).sort((a, b) => (a.pick_sequence ?? '').localeCompare(b.pick_sequence ?? ''))

  const reasonsRes = await db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick').eq('active', true)
  const shortPickReasons = unwrap(reasonsRes)

  return { orders, lines, shortPickReasons }
}
