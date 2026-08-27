import { redirect } from 'next/navigation'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { WorkerManagementBoard } from '@/components/workers/WorkerManagementBoard'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getWorkerData } from '@/lib/queries/workers'

export default async function WorkerManagementPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const supabase = await createClient()
  const { users } = await getWorkerData(supabase, warehouseCode)

  const active = users.filter((u) => u.active).length
  const pickersOnShift = users.filter((u) => u.role === 'picker' && u.active).length
  const roles = new Set(users.map((u) => u.role)).size

  return (
    <AppLayout activeNavId={13}>
      <TopBar title="User Management" subtitle={`จัดการผู้ใช้งาน · ${warehouseCode}`} />
      <div className="page-body">
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)' }}>
          <KpiCard label="TOTAL USERS" labelTh="ผู้ใช้งานทั้งหมด" value={users.length} />
          <KpiCard label="ACTIVE" labelTh="ใช้งานอยู่" value={active} valueColor="#16A34A" />
          <KpiCard label="PICKERS" labelTh="ผู้หยิบสินค้า" value={pickersOnShift} />
          <KpiCard label="ROLES IN USE" labelTh="บทบาทที่ใช้งาน" value={roles} />
        </div>
        <WorkerManagementBoard users={users} warehouseCode={warehouseCode} />
      </div>
    </AppLayout>
  )
}
