import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

/** Live Packing Monitor > Cancel: a Pack Supervisor closes an order that was scanned to start but
 * never finished (wrong scan, packer left, carried over to the next day). The session is kept as
 * 'cancelled' -- never counted in productivity -- and the order goes back to the pack queue. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'pack_supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const { session_id, reason } = (await request.json()) as { session_id?: string; reason?: string }
  if (!session_id || !reason?.trim()) return NextResponse.json({ error: 'session_id and reason are required · ต้องระบุเหตุผล' }, { status: 400 })

  const admin = createAdminClient()
  let q = admin
    .from('pack_sessions')
    .update({ finished_at: new Date().toISOString(), result: 'cancelled', cancelled_by: caller.user_id, cancel_reason: reason.trim() })
    .eq('session_id', session_id)
    .is('finished_at', null)
  if (caller.warehouse_code) q = q.eq('warehouse_code', caller.warehouse_code)
  const { data: session } = await q.select('session_id, order_id, picker_id, station_code').maybeSingle()
  if (!session) return NextResponse.json({ error: 'งานนี้ถูกปิดไปแล้ว · Already finished or not found' }, { status: 409 })

  await admin.from('orders').update({ pack_status: 'pending' }).eq('order_id', session.order_id).eq('pack_status', 'packing')
  await writeStatusHistory(admin, { entityType: 'order_pack', entityId: session.order_id, oldStatus: 'packing', newStatus: 'pending', changedBy: caller.user_id, reason: reason.trim() })
  await writeAudit(admin, { userId: caller.user_id, action: 'pack.cancel_session', entityType: 'orders', entityId: session.order_id, after: { ...session, reason: reason.trim() } })
  return NextResponse.json({ ok: true })
}
