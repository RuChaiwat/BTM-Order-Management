import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { WorkAssignmentBoard } from '@/components/assignment/WorkAssignmentBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveZoneCodes } from '@/lib/queries/locations'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function WorkAssignmentPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  const [ordersRes, linesRes, pickersRes, zones] = await Promise.all([
    admin.from('orders').select('order_id, order_no, store_code, original_order_date, planned_pieces, unique_sku_count').eq('warehouse_code', warehouseCode).eq('status', 'new'),
    admin.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode),
    admin.from('employees_users').select('user_id, name_en, zone_scope').eq('warehouse_code', warehouseCode).eq('role', 'picker').eq('active', true),
    getActiveZoneCodes(admin, warehouseCode),
  ])
  if (ordersRes.error) console.error('[assignment] orders error', ordersRes.error.message)
  if (linesRes.error) console.error('[assignment] order_lines error', linesRes.error.message)
  const pendingOrders = ordersRes.data
  const lines = linesRes.data
  const pickers = pickersRes.data

  const zonesByOrder = new Map<string, Set<string>>()
  for (const l of lines ?? []) {
    if (!l.zone_code) continue
    if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
    zonesByOrder.get(l.order_id)!.add(l.zone_code)
  }

  const orders = (pendingOrders ?? []).map((o) => ({ ...o, zones: [...(zonesByOrder.get(o.order_id) ?? new Set())] }))

  return (
    <AppLayout activeNavId={7}>
      <TopBar title="Work Assignment" subtitle={`มอบหมายงาน · ${warehouseCode}`} />
      <WorkAssignmentBoard orders={orders} pickers={pickers ?? []} warehouseCode={warehouseCode} zones={zones.length > 0 ? zones : ['A']} />
    </AppLayout>
  )
}
