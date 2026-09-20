import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { WorkerManagementBoard } from '@/components/workers/WorkerManagementBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getWorkerData } from '@/lib/queries/workers'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function WorkerManagementPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const { users } = await getWorkerData(admin, warehouseCode)

  const active = users.filter((u) => u.active).length
  const roles = new Set(users.map((u) => u.role)).size

  return (
    <>
      <TopBar title="User Management" subtitle={`จัดการผู้ใช้งาน · ${warehouseCode}`} />
      <div className="page-body">
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          <KpiCard label="TOTAL USERS" labelTh="ผู้ใช้งานทั้งหมด" value={users.length} />
          <KpiCard label="ACTIVE" labelTh="ใช้งานอยู่" value={active} valueColor="#16A34A" />
          <KpiCard label="ROLES IN USE" labelTh="บทบาทที่ใช้งาน" value={roles} />
        </div>
        <WorkerManagementBoard users={users} warehouseCode={warehouseCode} />
      </div>
    </>
  )
}
