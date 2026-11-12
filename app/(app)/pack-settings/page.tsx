import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { PackSettingsBoard } from '@/components/packing/PackSettingsBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'

export const dynamic = 'force-dynamic'

export default async function PackSettingsPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 27)
  const admin = createAdminClient()

  let stationsQuery = admin.from('pack_stations').select('station_code, name, active, warehouse_code').order('station_code')
  if (user.warehouse_code) stationsQuery = stationsQuery.or(`warehouse_code.eq.${user.warehouse_code},warehouse_code.is.null`)
  const [{ data: stations }, { data: reasons }] = await Promise.all([stationsQuery, admin.from('pack_issue_reasons').select('reason_code, label_en, label_th, active').order('sort_order')])

  return (
    <>
      <TopBar title="Pack Settings" subtitle="ตั้งค่างานแพ็ก · Pack Station และรายการปัญหา" />
      <PackSettingsBoard stations={stations ?? []} reasons={reasons ?? []} />
    </>
  )
}
