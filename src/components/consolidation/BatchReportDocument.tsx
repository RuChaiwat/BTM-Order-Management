import { Barcode } from '@/components/Barcode'
import type { PickReportLine } from '@/lib/queries/consolidation'

export const PICK_REPORT_PRINT_CSS = `
  .a4-report { font-family: 'Noto Sans Thai', Arial, sans-serif; color: #1F2937; max-width: 800px; margin: 0 auto 0; padding: 24px; }
  .a4-report table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 11px; }
  .a4-report th, .a4-report td { border: 1px solid #D1D5DB; padding: 4px 6px; text-align: left; overflow-wrap: break-word; vertical-align: middle; }
  .a4-report th { background: #F3F4F6; }
  .a4-report svg { max-width: 100%; height: auto; display: block; }
  /* An <svg> with no width/height/viewBox yet (before JsBarcode's effect has run, or if it fails
     on an invalid value) defaults to the browser's replaced-element size of 300x150 -- scaling
     it down to a fixed row height, rather than the general rule above, keeps a not-yet-drawn or
     failed barcode from blowing out its table row. */
  .a4-report td svg { max-height: 22px; width: auto; }
  .no-print { }
  @media print {
    @page { size: A4 portrait; margin: 10mm 12mm; }
    .no-print { display: none !important; }
    .a4-report { max-width: none; padding: 0; }
  }
`

const ROWS_PER_PAGE = 20

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]]
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

interface BatchInfo {
  consol_batch_id: string
  batch_no: string
  order_date: string
  priority: string
  stores_count: number
  orders_count: number
  total_pieces: number
}

interface OrderInfo {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  unique_sku_count: number
}

interface BatchReportDocumentProps {
  batch: BatchInfo
  warehouseCode: string
  orders: OrderInfo[]
  pickLines: PickReportLine[]
  generatedAt: string
  generatedByName: string
  /** Whether this is the last batch in the printed document — controls whether a page break is
   * inserted after this batch's Order Grouping sheet so the next batch starts on a fresh page. */
  isLastInDocument?: boolean
}

/**
 * Two report types per batch, always printed together in this order (§ user request: the Order
 * Grouping sheet must always come right after its batch's pick list so they stay paired):
 *  1. Consolidated Pick Report — one or more A4 pages of pick lines, chunked at ROWS_PER_PAGE so
 *     a long batch gets real page breaks with the batch header + signature line repeated on every
 *     page (native `<table>` pagination can't do this across separate per-page tables, so each
 *     page is rendered as its own self-contained header+table+footer block instead).
 *  2. Order Grouping — Sorting Sheet — one page listing every Order in the batch (store, order
 *     no, pieces) so floor staff can sort picked goods back out by destination store. A batch is
 *     capped at consolidation.max_stores (8) orders, so this never needs its own pagination.
 */
export function BatchReportDocument({ batch, warehouseCode, orders, pickLines, generatedAt, generatedByName, isLastInDocument = true }: BatchReportDocumentProps) {
  const zones = [...new Set(pickLines.map((l) => l.zoneCode).filter(Boolean))].sort() as string[]
  const uniqueSkuCount = new Set(pickLines.map((l) => l.sku)).size
  const pages = chunk(pickLines, ROWS_PER_PAGE)
  // The Order Grouping sheet is the last page of this same numbered sequence, not a separate
  // document -- it's one continuous printout per batch (pick list pages, then the sorting sheet).
  const totalDocPages = pages.length + 1

  return (
    <>
      {pages.map((rows, i) => (
        <div className="a4-report" key={`${batch.consol_batch_id}-pick-${i}`} style={{ breakAfter: 'page' }}>
          <ReportHeader
            title="Consolidated Pick Report"
            batch={batch}
            warehouseCode={warehouseCode}
            generatedAt={generatedAt}
            generatedByName={generatedByName}
            pageLabel={`Page ${i + 1} of ${totalDocPages}`}
          />
          <SummaryRow stores={batch.stores_count} orders={batch.orders_count} uniqueSku={uniqueSkuCount} totalPieces={batch.total_pieces} zones={zones} />

          <table>
            <colgroup>
              <col style={{ width: '4%' }} />
              <col style={{ width: '6%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '30%' }} />
              <col style={{ width: '10%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>Seq</th>
                <th>Zone</th>
                <th>Bin Code</th>
                <th>SKU Barcode</th>
                <th>Description</th>
                <th>
                  Total
                  <br />
                  Pick Qty
                </th>
                <th>Picked</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, j) => (
                <tr key={`${l.sku}-${l.binCode}`}>
                  <td>{i * ROWS_PER_PAGE + j + 1}</td>
                  <td>{l.zoneCode ?? '—'}</td>
                  <td>
                    <Barcode value={l.binCode} height={18} width={1} fontSize={8} />
                  </td>
                  <td>
                    <Barcode value={l.skuBarcode ?? l.sku} height={18} width={1} fontSize={8} />
                  </td>
                  <td>{l.description ?? ''}</td>
                  <td style={{ fontWeight: 700, textAlign: 'center' }}>{l.qty}</td>
                  <td style={{ textAlign: 'center', color: '#9CA3AF' }}>______</td>
                </tr>
              ))}
            </tbody>
          </table>

          <SignatureLine />
        </div>
      ))}

      <div className="a4-report" style={{ breakAfter: isLastInDocument ? undefined : 'page' }}>
        <ReportHeader
          title="Order Grouping — Sorting Sheet"
          batch={batch}
          warehouseCode={warehouseCode}
          generatedAt={generatedAt}
          generatedByName={generatedByName}
          pageLabel={`Page ${totalDocPages} of ${totalDocPages}`}
        />
        <SummaryRow stores={batch.stores_count} orders={batch.orders_count} uniqueSku={uniqueSkuCount} totalPieces={batch.total_pieces} zones={zones} />

        <table>
          <colgroup>
            <col style={{ width: '6%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '22%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>Seq</th>
              <th>Store Code</th>
              <th>Order No</th>
              <th>Unique SKU</th>
              <th>Total Pieces</th>
            </tr>
          </thead>
          <tbody>
            {orders.map((o, i) => (
              <tr key={o.order_id}>
                <td>{i + 1}</td>
                <td>{o.store_code}</td>
                <td>
                  <Barcode value={o.order_no} height={18} width={1} fontSize={8} />
                </td>
                <td>{o.unique_sku_count}</td>
                <td style={{ fontWeight: 700 }}>{o.planned_pieces}</td>
              </tr>
            ))}
            {orders.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: '#6B7280' }}>
                  No orders linked to this batch.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}

function ReportHeader({
  title,
  batch,
  warehouseCode,
  generatedAt,
  generatedByName,
  pageLabel,
}: {
  title: string
  batch: BatchInfo
  warehouseCode: string
  generatedAt: string
  generatedByName: string
  pageLabel?: string
}) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '2px solid #1F2937', paddingBottom: 10, marginBottom: 10 }}>
      <div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>{title}</div>
        <div style={{ fontSize: 11, color: '#6B7280' }}>
          Warehouse {warehouseCode} · Order Date {batch.order_date} · Priority {batch.priority}
        </div>
        <div style={{ fontSize: 11, color: '#6B7280' }}>
          Generated {generatedAt} · by {generatedByName}
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: '#6B7280' }}>Batch No</div>
        <Barcode value={batch.batch_no} height={30} />
        {pageLabel && <div style={{ fontSize: 10.5, color: '#6B7280', marginTop: 2 }}>{pageLabel}</div>}
      </div>
    </div>
  )
}

function SummaryRow({ stores, orders, uniqueSku, totalPieces, zones }: { stores: number; orders: number; uniqueSku: number; totalPieces: number; zones: string[] }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 8, marginBottom: 14, fontSize: 11 }}>
      <SummaryBox label="Stores" value={stores} />
      <SummaryBox label="Orders" value={orders} />
      <SummaryBox label="Unique SKU" value={uniqueSku} />
      <SummaryBox label="Total Pieces" value={totalPieces} />
      <SummaryBox label="Zones Covered" value={zones.join(', ') || '—'} />
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

function SignatureLine() {
  return (
    <div style={{ marginTop: 20, fontSize: 12, display: 'flex', gap: 40 }}>
      <span>ลงชื่อพนักงานเบิก _______________________</span>
      <span>วันที่ ____ / _____ / ______</span>
    </div>
  )
}
