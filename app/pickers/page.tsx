import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { PickerManagementBoard } from '@/components/pickers/PickerManagementBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getPickers } from '@/lib/queries/pickers'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function PickerManagementPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const pickers = await getPickers(admin, warehouseCode)

  const active = pickers.filter((p) => p.active).length

  return (
    <AppLayout activeNavId={17} user={user}>
      <TopBar title="Picker Management" subtitle={`จัดการพนักงานหยิบสินค้า · ${warehouseCode}`} />
      <div className="page-body">
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
          <KpiCard label="TOTAL PICKERS" labelTh="พนักงานหยิบสินค้าทั้งหมด" value={pickers.length} />
          <KpiCard label="ACTIVE" labelTh="ใช้งานอยู่" value={active} valueColor="#16A34A" />
        </div>
        <PickerManagementBoard pickers={pickers} warehouseCode={warehouseCode} />
      </div>
    </AppLayout>
  )
}
