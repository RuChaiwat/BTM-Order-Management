import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'
import { cancelStalePackSessions } from '@/lib/packing'

/** Daily, just after midnight Bangkok (vercel.json): cancel every pack session still open from a
 * previous day -- no packing carries over (client rule). Same as the safety net that runs when Live
 * Packing Monitor loads or a packer scans an order; see cancelStalePackSessions. */
export async function GET(request: Request) {
  const isCron = request.headers.get('authorization') === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) {
    const user = await getSessionUser()
    if (!user || user.role !== 'system_admin') return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const cancelled = await cancelStalePackSessions(createAdminClient())
  return NextResponse.json({ cancelled })
}
