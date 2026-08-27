import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { WorkAssignmentBoard } from '@/components/assignment/WorkAssignmentBoard'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function WorkAssignmentPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const supabase = await createClient()

  const [{ data: pendingOrders }, { data: lines }, { data: pickers }, { data: zoneRows }] = await Promise.all([
    supabase.from('orders').select('order_id, order_no, store_code, original_order_date, planned_pieces, unique_sku_count').eq('warehouse_code', warehouseCode).eq('status', 'new'),
    supabase.from('order_lines').select('order_id, zone_code').eq('warehouse_code', warehouseCode),
    supabase.from('employees_users').select('user_id, name_en, zone_scope').eq('warehouse_code', warehouseCode).eq('role', 'picker').eq('active', true),
    supabase.from('locations').select('zone_code').eq('warehouse_code', warehouseCode).eq('active', true),
  ])

  const zonesByOrder = new Map<string, Set<string>>()
  for (const l of lines ?? []) {
    if (!l.zone_code) continue
    if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
    zonesByOrder.get(l.order_id)!.add(l.zone_code)
  }

  const orders = (pendingOrders ?? []).map((o) => ({ ...o, zones: [...(zonesByOrder.get(o.order_id) ?? new Set())] }))
  const zones = [...new Set((zoneRows ?? []).map((z) => z.zone_code))].sort()

  return (
    <AppLayout activeNavId={7}>
      <TopBar title="Work Assignment" subtitle={`มอบหมายงาน · ${warehouseCode}`} />
      <WorkAssignmentBoard orders={orders} pickers={pickers ?? []} warehouseCode={warehouseCode} zones={zones.length > 0 ? zones : ['A']} />
    </AppLayout>
  )
}
