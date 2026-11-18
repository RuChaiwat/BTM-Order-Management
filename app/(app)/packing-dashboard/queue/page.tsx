import Link from 'next/link'
import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { AutoRefresh } from '@/components/AutoRefresh'
import { BackButton } from '@/components/BackButton'
import { ExportExcelButton } from '@/components/ExportExcelButton'
import { PackQueueTable } from '@/components/packing/PackQueueTable'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { requireMenuAccess } from '@/lib/pageAccess'
import { getPackQueue } from '@/lib/queries/packing'
import { BACKLOG_META, BACKLOG_STATUSES, isBacklogStatus } from '@/lib/packBacklog'
import { getRefreshIntervalMs } from '@/lib/queries/config'
import { AUTO_REFRESH_KEYS } from '@/lib/configCatalog'

export const dynamic = 'force-dynamic'

/** Drill-down from Packing Dashboard's Backlog / Waiting to pack cards -- same access as the
 * dashboard (menu 21), so it has no sidebar entry of its own. ?status= all | pending | packing |
 * packed | issue picks the rows; the chips switch between them. */
export default async function PackQueuePage({ searchParams }: { searchParams: { status?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  requireMenuAccess(user.role, 21)
  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const status = isBacklogStatus(searchParams.status) ? searchParams.status : 'all'
  const [all, refreshMs] = await Promise.all([getPackQueue(admin, warehouseCode), getRefreshIntervalMs(admin, AUTO_REFRESH_KEYS.packingDashboard)])
  const rows = status === 'all' ? all : all.filter((r) => r.pack_status === status)
  const pieces = rows.reduce((s, r) => s + r.pieces, 0)
  const label = status === 'all' ? 'ทั้งหมด' : BACKLOG_META[status].label
  const chips = [
    { key: 'all', label: 'ทั้งหมด', color: undefined, count: all.length },
    ...BACKLOG_STATUSES.map((st) => ({ key: st, label: BACKLOG_META[st].label, color: BACKLOG_META[st].color, count: all.filter((r) => r.pack_status === st).length })),
  ]

  return (
    <>
      <AutoRefresh intervalMs={refreshMs} />
      <TopBar title="Pack Backlog" subtitle={`งานแพ็กคงค้าง · ${label} · ${rows.length.toLocaleString()} order · ${pieces.toLocaleString()} ชิ้น · ${warehouseCode}`}>
        <BackButton fallbackHref="/packing-dashboard" />
        <ExportExcelButton href={`/api/packing-queue/export?status=${status}`} />
      </TopBar>
      <div className="page-body" style={{ padding: '18px 24px', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {chips.map((c) => {
            const active = c.key === status
            return (
              <Link
                key={c.key}
                href={`/packing-dashboard/queue?status=${c.key}`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 12px',
                  borderRadius: 999,
                  fontSize: 12.5,
                  textDecoration: 'none',
                  border: `1px solid ${active ? 'var(--color-info)' : 'var(--color-border)'}`,
                  background: active ? 'var(--color-info-bg)' : 'var(--color-surface)',
                  color: 'inherit',
                  fontWeight: active ? 700 : 400,
                }}
              >
                {c.color && <span style={{ width: 10, height: 10, borderRadius: '50%', background: c.color }} />}
                {c.label} · {c.count.toLocaleString()}
              </Link>
            )
          })}
        </div>
        <PackQueueTable rows={rows} showStatus={status === 'all'} title={`Pack backlog · ${label}`} />
      </div>
    </>
  )
}
