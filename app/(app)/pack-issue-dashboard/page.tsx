import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { KpiCard } from '@/components/KpiCard'
import { PackDateFilter } from '@/components/packing/PackDateFilter'
import { BarList } from '@/components/packing/BarList'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getPackIssueDashboard } from '@/lib/queries/packing'
import { PACK_ROOT_CAUSES } from '@/lib/packing'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'

export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export default async function PackIssueDashboardPage({ searchParams }: { searchParams: { from?: string; to?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 26)
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const today = bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
  const defaultFrom = bangkokDateKey(new Date(Date.now() - 29 * 86400000)) ?? today
  let from = DATE_RE.test(searchParams.from ?? '') ? searchParams.from! : defaultFrom
  let to = DATE_RE.test(searchParams.to ?? '') ? searchParams.to! : today
  if (from > to) [from, to] = [to, from]
  const d = await getPackIssueDashboard(createAdminClient(), warehouseCode, from, to)
  const rootLabel = new Map(PACK_ROOT_CAUSES.map((r) => [r.code, r.th]))
  const rows = (list: { key: string; count: number; pieces: number }[], label?: (k: string) => string) => list.map((r) => ({ label: label ? label(r.key) : r.key, value: r.count, sub: `· ${r.pieces.toLocaleString()} ชิ้น` }))

  const card = (title: string, th: string, children: React.ReactNode) => (
    <div className="card">
      <div className="card-title">{title}</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        {th}
      </div>
      {children}
    </div>
  )

  return (
    <>
      <TopBar title="Pack Issue Dashboard" subtitle={`แดชบอร์ดปัญหาการแพ็ก · ${formatDate(from)} – ${formatDate(to)} · ${warehouseCode}`}>
        <PackDateFilter basePath="/pack-issue-dashboard" from={from} to={to} />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
        <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(5, 1fr)', gap: 12 }}>
          <KpiCard label="ISSUES" labelTh="จำนวนเรื่องที่แจ้ง" value={d.kpis.issues.toLocaleString()} valueColor={d.kpis.issues ? '#DC2626' : undefined} compact style={{ padding: 14 }} />
          <KpiCard label="ISSUE PIECES" labelTh="จำนวนชิ้นที่มีปัญหา" value={d.kpis.pieces.toLocaleString()} compact style={{ padding: 14 }} />
          <KpiCard label="ISSUE RATE" labelTh="% ของ order ที่แพ็ก" value={d.kpis.issueRatePct !== null ? `${d.kpis.issueRatePct}%` : '—'} sub={`${d.kpis.packedOrders.toLocaleString()} order ที่แพ็ก`} compact style={{ padding: 14 }} />
          <KpiCard label="STILL OPEN" labelTh="ยังไม่ปิดเรื่อง" value={d.kpis.open.toLocaleString()} valueColor={d.kpis.open ? '#F59E0B' : undefined} compact style={{ padding: 14 }} />
          <KpiCard label="AVG TIME TO RESOLVE" labelTh="เวลาเฉลี่ยในการปิดเรื่อง" value={d.kpis.avgResolveMinutes !== null ? `${d.kpis.avgResolveMinutes.toLocaleString()} นาที` : '—'} compact style={{ padding: 14 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, alignItems: 'start' }}>
          {card('By problem', 'แยกตามประเภทปัญหา (จำนวนรายการ · ชิ้น)', <BarList rows={rows(d.byReason)} color="var(--color-danger)" />)}
          {card('By station', 'แยกตาม Station ที่แจ้ง (เรื่อง · ชิ้น)', <BarList rows={rows(d.byStation)} color="var(--color-info)" />)}
          {card('By picker', 'แยกตามคนที่ Pick order นั้น — Top 15 (เรื่อง · ชิ้น)', <BarList rows={rows(d.byPicker)} color="var(--color-warning)" />)}
          {card('By zone', 'แยกตาม Zone ของสินค้าที่มีปัญหา (รายการ · ชิ้น)', <BarList rows={rows(d.byZone)} color="var(--color-warning)" />)}
          {card('By root cause', 'สาเหตุจริงจากการตรวจสอบ (เฉพาะเรื่องที่ปิดแล้ว)', <BarList rows={rows(d.byRootCause, (k) => rootLabel.get(k) ?? k)} color="var(--color-success)" />)}
          {card('Daily trend', 'จำนวนเรื่องที่แจ้งรายวัน', <BarList rows={d.days.map((x) => ({ label: formatDate(x.day), value: x.count }))} color="var(--color-danger)" />)}
        </div>
      </div>
    </>
  )
}
