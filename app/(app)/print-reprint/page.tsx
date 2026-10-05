import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { PrintReprintBoard } from '@/components/printReprint/PrintReprintBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOpenOrdersForPrint } from '@/lib/queries/printReprint'
import { getActivePickers } from '@/lib/queries/pickers'

export const dynamic = 'force-dynamic'

export default async function PrintReprintPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  const [orders, pickers] = await Promise.all([getOpenOrdersForPrint(admin, warehouseCode), getActivePickers(admin, warehouseCode)])

  return (
    <>
      <TopBar title="Print & Reprint" subtitle={`พิมพ์ / พิมพ์ซ้ำเอกสาร · ${warehouseCode}`} />
      <div className="page-body">
        <PrintReprintBoard orders={orders} pickers={pickers.map((p) => ({ picker_id: p.picker_id, name_en: p.name_en }))} />
      </div>
    </>
  )
}
