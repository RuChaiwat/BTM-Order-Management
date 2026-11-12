import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { KpiCard } from '@/components/KpiCard'
import { BarList, HourBars } from '@/components/packing/BarList'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { canAccessMenuItem } from '@/lib/roles'
import { getPackingDashboardData } from '@/lib/queries/packing'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

export const dynamic = 'force-dynamic'

function hm(minutes: number) {
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ชม. ${minutes % 60} นาที` : `${minutes} นาที`
}

export default async function PackingDashboardPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 21)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const [d, refreshMs] = await Promise.all([getPackingDashboardData(admin, warehouseCode), getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.packingDashboard)])
  const link = (id: number, href: string, text: string) =>
    canAccessMenuItem(user.role, id) ? (
      <Link href={href} className="card-link" style={{ fontSize: 12 }}>
        {text} →
      </Link>
    ) : null

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Packing Dashboard" subtitle={`แดชบอร์ดงานแพ็ก · วันนี้ · ${warehouseCode}`} />
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <Link href="/packing-dashboard/queue" title="ดูรายการ order ที่รอแพ็ก" style={{ display: 'block', color: 'inherit', textDecoration: 'none' }}>
            <KpiCard
              label="WAITING TO PACK"
              labelTh="รอแพ็ก"
              value={d.counts.pending.toLocaleString()}
              sub={
                <>
                  {d.counts.pending ? `เก่าสุด ${hm(d.oldestMinutes)} · ` : 'ไม่มีงานค้าง · '}
                  <span className="card-link" style={{ fontSize: 12 }}>
                    ดูรายการ →
                  </span>
                </>
              }
              compact
              style={{ padding: 14, height: '100%', cursor: 'pointer' }}
            />
          </Link>
          <KpiCard label="PACKING NOW" labelTh="กำลังแพ็ก" value={d.counts.packing.toLocaleString()} sub={link(22, '/pack-monitor', 'Live monitor')} compact style={{ padding: 14 }} />
          <KpiCard label="AWAITING CONFIRM" labelTh="แพ็กเสร็จ รอยืนยัน" value={d.counts.packed.toLocaleString()} sub={link(23, '/pack-verification', 'Admin Pack Verify')} compact style={{ padding: 14 }} />
          <KpiCard
            label="OPEN ISSUES"
            labelTh="ปัญหายังไม่ปิด"
            value={d.counts.openIssues.toLocaleString()}
            valueColor={d.counts.openIssues ? '#DC2626' : undefined}
            sub={link(24, '/pack-issues', 'ตรวจสอบปัญหา') ?? `${d.counts.issue.toLocaleString()} orders`}
            compact
            style={{ padding: 14 }}
          />
          <KpiCard label="PACKED TODAY" labelTh="แพ็กเสร็จวันนี้ (ชิ้น)" value={d.today.pieces.toLocaleString()} valueColor="#16A34A" sub={`${d.today.orders.toLocaleString()} orders · ${d.today.packers} คน · ยืนยันแล้ว ${d.today.confirmed.toLocaleString()}`} compact style={{ padding: 14 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.6fr)', gap: 14, alignItems: 'start' }}>
          <div className="card">
            <div className="card-title">Pack backlog aging</div>
            <div className="card-subtitle" style={{ marginBottom: 14 }}>
              อายุของ order ที่รอแพ็ก นับจากเวลาที่ผ่าน Admin Verification
            </div>
            <BarList rows={d.aging.map((a) => ({ label: a.label, value: a.count }))} color="var(--color-warning)" />
          </div>
          <div className="card">
            <div className="card-title">Pieces packed per hour (today)</div>
            <div className="card-subtitle">จำนวนชิ้นที่แพ็กเสร็จรายชั่วโมง (ไม่นับชิ้นที่แจ้งปัญหา)</div>
            <HourBars rows={d.hourly.map((h) => ({ hour: h.hour, value: h.pieces }))} color="var(--color-success)" />
          </div>
        </div>
      </div>
    </>
  )
}
