import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'
import { getPackOrderLines } from '@/lib/packing'

const PACK_ADMIN_ROLES = ['system_admin', 'pack_supervisor']

/** Lines of one packed order, for the detail panel of Admin Pack Verify. */
export async function GET(request: Request) {
  try {
    await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const orderId = new URL(request.url).searchParams.get('order_id')
  if (!orderId) return NextResponse.json({ error: 'order_id is required' }, { status: 400 })
  const admin = createAdminClient()
  const { lines, pieces } = await getPackOrderLines(admin, orderId)
  return NextResponse.json({ lines, pieces })
}

/**
 * Admin Pack Verify: the Pack Supervisor has confirmed the pack in WMS and now confirms it here,
 * for one order or many at once. No reject (client decision) -- problems are raised by the packer
 * with Completed with Short and handled on the Pack Issue screen instead. Each order is guarded on
 * still being 'packed' (compare-and-swap), so two supervisors confirming the same order can't both
 * record it; the ones that fail are reported back by order number.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { order_ids } = (await request.json()) as { order_ids?: string[] }
  if (!Array.isArray(order_ids) || order_ids.length === 0) return NextResponse.json({ error: 'order_ids is required' }, { status: 400 })
  if (order_ids.length > 500) return NextResponse.json({ error: 'Confirm at most 500 orders at a time' }, { status: 400 })

  const admin = createAdminClient()
  const confirmed: string[] = []
  const failed: string[] = []
  for (const orderId of [...new Set(order_ids)]) {
    let q = admin.from('orders').update({ pack_status: 'confirmed' }).eq('order_id', orderId).eq('pack_status', 'packed')
    if (caller.warehouse_code) q = q.eq('warehouse_code', caller.warehouse_code)
    const { data: row } = await q.select('order_id, order_no').maybeSingle()
    if (!row) {
      const { data: o } = await admin.from('orders').select('order_no').eq('order_id', orderId).maybeSingle()
      failed.push(o?.order_no ?? orderId)
      continue
    }
    await admin.from('pack_verifications').insert({ order_id: orderId, admin_id: caller.user_id })
    await writeStatusHistory(admin, { entityType: 'order_pack', entityId: orderId, oldStatus: 'packed', newStatus: 'confirmed', changedBy: caller.user_id })
    confirmed.push(row.order_no)
  }

  if (confirmed.length > 0) {
    await writeAudit(admin, { userId: caller.user_id, action: 'pack_verification.confirm', entityType: 'orders', entityId: confirmed.length === 1 ? order_ids[0] : null, after: { confirmed } })
  }
  return NextResponse.json({ confirmed: confirmed.length, failed })
}
