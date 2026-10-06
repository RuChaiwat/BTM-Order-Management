import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { OrderImportForm } from '@/components/orderPool/OrderImportForm'
import { RecentImportsTable } from '@/components/orderPool/RecentImportsTable'
import { OrderPoolOverview } from '@/components/orderPool/OrderPoolOverview'
import { CancelOrderPanel } from '@/components/orderPool/CancelOrderPanel'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrderPoolOverview } from '@/lib/queries/orderPool'
import { getSessionUser } from '@/lib/auth'

// The Recent Imports table must reflect the import that just happened, not a stale server-cached
// render — force this route to always be server-rendered per request.
export const dynamic = 'force-dynamic'

export default async function OrderPoolPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  const [{ data: importBatches, error: importsError }, overview, { data: cancelReasons }] = await Promise.all([
    // Capped well past a single page's worth (20/page in RecentImportsTable) -- an append-only
    // operational log, same shape as Audit Trail, not a "last 10" preview.
    admin.from('import_batches').select('import_id, file_name, uploaded_at, status, total_rows, success_rows, error_rows').order('uploaded_at', { ascending: false }).limit(200),
    getOrderPoolOverview(admin, warehouseCode),
    admin.from('reason_master').select('reason_code, label_en').eq('reason_type', 'cancel').eq('active', true).order('label_en'),
  ])
  if (importsError) console.error('[orders] import_batches error', importsError.message)

  return (
    <>
      <TopBar title="Order Pool / Import Status" subtitle="พูลออเดอร์ / สถานะนำเข้า · WMS Transfer Order export" />
      <div className="page-body">
        <OrderImportForm
          endpointBase="/api/imports/orders"
          hint={'Upload the WMS Transfer Order export (.xlsx) — must contain both the "Transfer List" (order header, only BT Status = Picking is imported) and "Warehouse Pick Lines" (order lines) sheets'}
        />

        <div className="card">
          <div className="card-title">Recent imports</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            ประวัติการนำเข้าล่าสุด · click a column to sort
          </div>
          <RecentImportsTable rows={importBatches ?? []} />
        </div>

        <OrderPoolOverview totalOrders={overview.totalOrders} zoneDensity={overview.zoneDensity} bands={overview.bands} thresholds={overview.thresholds} />

        <CancelOrderPanel reasons={cancelReasons ?? []} />
      </div>
    </>
  )
}
