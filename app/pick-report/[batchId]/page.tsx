import { notFound, redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { getBatchDetail, buildPickReportLines } from '@/lib/queries/consolidation'
import { Barcode } from '@/components/Barcode'
import { PrintButton } from '@/components/PrintButton'

export default async function PickReportPage({ params }: { params: { batchId: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const supabase = await createClient()
  const detail = await getBatchDetail(supabase, params.batchId)
  if (!detail) notFound()

  const { batch, orders, lines } = detail
  const pickLines = buildPickReportLines(lines, orders)
  const zones = [...new Set(lines.map((l) => l.zone_code).filter(Boolean))].sort()
  const uniqueSkuCount = new Set(lines.map((l) => l.sku)).size

  return (
    <div className="a4-report">
      <style>{`
        .a4-report { font-family: 'Noto Sans Thai', Arial, sans-serif; color: #1F2937; max-width: 800px; margin: 0 auto; padding: 24px; }
        .a4-report table { width: 100%; border-collapse: collapse; font-size: 11px; }
        .a4-report th, .a4-report td { border: 1px solid #D1D5DB; padding: 4px 6px; text-align: left; }
        .a4-report th { background: #F3F4F6; }
        .no-print { }
        @media print {
          @page { size: A4 portrait; margin: 10mm 12mm; }
          .no-print { display: none !important; }
          .a4-report { max-width: none; padding: 0; }
        }
      `}</style>

      <div className="no-print" style={{ marginBottom: 16 }}>
        <PrintButton />
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1F2937', paddingBottom: 10, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>Consolidated Pick Report</div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>
            Warehouse {orders[0]?.warehouse_code ?? user.warehouse_code} · Order Date {batch.order_date} · Priority {batch.priority}
          </div>
          <div style={{ fontSize: 11, color: '#6B7280' }}>
            Generated {new Date().toLocaleString()} · by {user.name_en}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 11, color: '#6B7280' }}>Batch No</div>
          <Barcode value={batch.consol_batch_id} height={30} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14, fontSize: 11 }}>
        <SummaryBox label="Stores" value={batch.stores_count} />
        <SummaryBox label="Orders" value={batch.orders_count} />
        <SummaryBox label="Unique SKU" value={uniqueSkuCount} />
        <SummaryBox label="Total Pieces" value={batch.total_pieces} />
        <SummaryBox label="Zones Covered" value={zones.join(', ') || '—'} />
      </div>

      <table>
        <thead>
          <tr>
            <th>Seq</th>
            <th>Zone</th>
            <th>Bin</th>
            <th>Bin Barcode</th>
            <th>SKU</th>
            <th>SKU Barcode</th>
            <th>Description</th>
            <th>Total Pick Qty</th>
            <th>Stores</th>
            <th>Orders</th>
          </tr>
        </thead>
        <tbody>
          {pickLines.map((l, i) => (
            <tr key={`${l.sku}-${l.binCode}`}>
              <td>{i + 1}</td>
              <td>{l.zoneCode ?? '—'}</td>
              <td>{l.binCode}</td>
              <td>
                <Barcode value={l.binCode} height={18} width={1} fontSize={8} />
              </td>
              <td>{l.sku}</td>
              <td>
                <Barcode value={l.sku} height={18} width={1} fontSize={8} />
              </td>
              <td>{l.description ?? ''}</td>
              <td style={{ fontWeight: 700 }}>{l.qty}</td>
              <td>{l.storeCount}</td>
              <td>{l.orderCount}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, fontSize: 10.5, color: '#6B7280', lineHeight: 1.6 }}>
        Pick by physical location per Pick Sequence above. A SKU appearing in multiple Bin Codes stays on separate rows — WMS assigned two real pick
        locations (§11). Move picked goods to the Consolidation Area and confirm each order individually via WMS Picking-by-Order.
      </div>
    </div>
  )
}

function SummaryBox({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={{ border: '1px solid #D1D5DB', borderRadius: 4, padding: '6px 8px' }}>
      <div style={{ color: '#6B7280', fontSize: 9.5, textTransform: 'uppercase' }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13 }}>{value}</div>
    </div>
  )
}
