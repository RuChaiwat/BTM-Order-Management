import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { ShortPickMonitorDateFilter } from '@/components/shortPickMonitor/ShortPickMonitorDateFilter'
import { ShortPickMonitorBoard } from '@/components/shortPickMonitor/ShortPickMonitorBoard'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getShortPickMonitorData } from '@/lib/queries/shortPickMonitor'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'

export const dynamic = 'force-dynamic'

export default async function ShortPickMonitorPage({ searchParams }: { searchParams: { date?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const date = searchParams.date || bangkokDateKey(new Date()) || new Date().toISOString().slice(0, 10)
  const data = await getShortPickMonitorData(admin, warehouseCode, date)

  return (
    <>
      <AutoRefresh />
      <TopBar title="Product Issue List" subtitle={`รายการสินค้ามีปัญหา · ${formatDate(date)} · ${warehouseCode}`}>
        <ShortPickMonitorDateFilter date={date} />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: `repeat(${Math.max(data.reasonKpis.length, 1)}, 1fr)`, gap: 12 }}>
          {data.reasonKpis.map((r) => (
            <KpiCard
              key={r.code}
              label={r.labelEn.toUpperCase()}
              labelTh={r.labelTh}
              value={r.shortQty.toLocaleString()}
              valueColor={r.shortQty > 0 ? '#F59E0B' : undefined}
              sub={`${r.count.toLocaleString()} order(s)`}
              compact
              style={{ padding: 14 }}
            />
          ))}
          {data.reasonKpis.length === 0 && (
            <KpiCard label="NO ACTIVE REASON CODES" labelTh="ไม่มีรหัสเหตุผลที่เปิดใช้งาน" value="—" compact style={{ padding: 14 }} />
          )}
        </div>

        <ShortPickMonitorBoard rows={data.rows} zones={data.zones} date={date} warehouseCode={warehouseCode} />
      </div>
    </>
  )
}
