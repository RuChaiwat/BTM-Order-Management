import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { UploadForm } from '@/components/UploadForm'
import { createAdminClient } from '@/lib/supabase/admin'

export default async function OrderPoolPage() {
  const admin = createAdminClient()

  const [{ data: orders, error: ordersError }, { data: importBatches, error: importsError }] = await Promise.all([
    admin.from('orders').select('order_no, warehouse_code, original_order_date, store_code, status, planned_pieces, unique_sku_count').order('created_at', { ascending: false }).limit(50),
    admin.from('import_batches').select('import_id, file_name, uploaded_at, status, total_rows, success_rows, error_rows').order('uploaded_at', { ascending: false }).limit(10),
  ])
  if (ordersError) console.error('[orders] orders error', ordersError.message)
  if (importsError) console.error('[orders] import_batches error', importsError.message)

  return (
    <AppLayout activeNavId={2}>
      <TopBar title="Order Pool / Import Status" subtitle="พูลออเดอร์ / สถานะนำเข้า · WMS Transfer Order export" />
      <div className="page-body">
        <UploadForm
          endpoint="/api/imports/orders"
          label="Import WMS orders"
          hint="Upload the Transfer Order export (.csv or .xlsx) — required columns: Transfer, Warehouse Code, Shipment Date, Store Code, Item No., Bin Code, Quantity"
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
                  <td>{b.error_rows}</td>
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

        <div className="card" style={{ flex: 1, minHeight: 0 }}>
          <div className="card-title">Order pool</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            50 most recent orders
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>ORDER NO.</th>
                <th>WAREHOUSE</th>
                <th>DATE</th>
                <th>STORE</th>
                <th>STATUS</th>
                <th>SKU</th>
                <th>PCS</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={`${o.warehouse_code}-${o.order_no}-${o.original_order_date}`}>
                  <td className="link">{o.order_no}</td>
                  <td>{o.warehouse_code}</td>
                  <td>{o.original_order_date}</td>
                  <td>{o.store_code}</td>
                  <td>{o.status}</td>
                  <td>{o.unique_sku_count}</td>
                  <td>{o.planned_pieces}</td>
                </tr>
              ))}
              {(!orders || orders.length === 0) && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                    No orders imported yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}
