import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { OrderImportForm } from '@/components/orderPool/OrderImportForm'
import { ImportErrorsViewer } from '@/components/ImportErrorsViewer'
import { OrderPoolOverview } from '@/components/orderPool/OrderPoolOverview'
import { createAdminClient } from '@/lib/supabase/admin'
import { getOrderPoolOverview } from '@/lib/queries/orderPool'
import { getSessionUser } from '@/lib/auth'

// The Recent Imports table must reflect the import that just happened, not a stale server-cached
// render — force this route to always be server-rendered per request.
export const dynamic = 'force-dynamic'

export default async function OrderPoolPage() {
  const user = await getSessionUser()
  const warehouseCode = user?.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  const [{ data: importBatches, error: importsError }, overview] = await Promise.all([
    admin.from('import_batches').select('import_id, file_name, uploaded_at, status, total_rows, success_rows, error_rows').order('uploaded_at', { ascending: false }).limit(10),
    getOrderPoolOverview(admin, warehouseCode),
  ])
  if (importsError) console.error('[orders] import_batches error', importsError.message)

  return (
    <AppLayout activeNavId={2}>
      <TopBar title="Order Pool / Import Status" subtitle="พูลออเดอร์ / สถานะนำเข้า · WMS Transfer Order export" />
      <div className="page-body">
        <OrderImportForm
          endpointBase="/api/imports/orders"
          hint="Upload the Transfer Order export (.csv or .xlsx) — required columns: Transfer, Warehouse Code, Shipment Date, Store Code, Item No., SKU Barcode, Bin Code, Quantity"
        />

        <div className="card">
          <div className="card-title">Recent imports</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            ประวัติการนำเข้าล่าสุด
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>FILE</th>
                <th>UPLOADED</th>
                <th>STATUS</th>
                <th>ROWS</th>
                <th>SUCCESS</th>
                <th>ERRORS</th>
              </tr>
            </thead>
            <tbody>
              {(importBatches ?? []).map((b) => (
                <tr key={b.import_id}>
                  <td>{b.file_name}</td>
                  <td>{new Date(b.uploaded_at).toLocaleString()}</td>
                  <td>
                    <span className={`badge badge-${b.status === 'completed' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'}`}>{b.status}</span>
                  </td>
                  <td>{b.total_rows}</td>
                  <td>{b.success_rows}</td>
                  <td>
                    <ImportErrorsViewer importId={b.import_id} errorCount={b.error_rows} />
                  </td>
                </tr>
              ))}
              {(!importBatches || importBatches.length === 0) && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                    No imports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <OrderPoolOverview totalOrders={overview.totalOrders} zoneDensity={overview.zoneDensity} bands={overview.bands} thresholds={overview.thresholds} />
      </div>
    </AppLayout>
  )
}
