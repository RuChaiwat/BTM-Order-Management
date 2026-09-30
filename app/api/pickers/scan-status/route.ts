import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { bangkokDateKey, bangkokDayRange } from '@/lib/formatDate'

/**
 * GET ?picker_id=XXX -- backs Work Assignment's picker-scan step (§Work Assignment follow-up):
 * 1. activeOrderCount -- orders still assigned/in_progress/correction_in_progress under this
 *    picker's own batches. Non-zero blocks a NEW assignment: the picker must clear their existing
 *    work at Pick Completion first, so nobody ends up holding two rounds' worth of orders at once.
 * 2. todayBatchCount -- how many separate batches (Confirm & start timer) this picker has already
 *    been given today (Bangkok calendar day) -- purely informational, shown as "X รอบ" so the admin
 *    can see at a glance how many rounds this picker has already done today.
 */
export async function GET(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  const pickerId = searchParams.get('picker_id')?.trim().toUpperCase()
  if (!pickerId) return NextResponse.json({ error: 'picker_id is required' }, { status: 400 })

  const admin = createAdminClient()
  const warehouseCode = caller.warehouse_code ?? 'DC002'

  const { data: batches } = await admin
    .from('assignment_batches')
    .select('assignment_batch_id, assigned_time')
    .eq('warehouse_code', warehouseCode)
    .eq('picker_id', pickerId)
  const batchIds = (batches ?? []).map((b) => b.assignment_batch_id)

  const { count: activeOrderCount } = batchIds.length
    ? await admin
        .from('orders')
        .select('order_id', { count: 'exact', head: true })
        .in('assignment_batch_id', batchIds)
        .in('status', ['assigned', 'in_progress', 'correction_in_progress'])
    : { count: 0 }

  const today = bangkokDateKey(new Date())!
  const { sinceIso, untilIso } = bangkokDayRange(today)
  const sinceMs = new Date(sinceIso).getTime()
  const untilMs = new Date(untilIso).getTime()
  const todayBatchCount = (batches ?? []).filter((b) => {
    if (!b.assigned_time) return false
    const t = new Date(b.assigned_time).getTime()
    return t >= sinceMs && t < untilMs
  }).length

  return NextResponse.json({ activeOrderCount: activeOrderCount ?? 0, todayBatchCount })
}
