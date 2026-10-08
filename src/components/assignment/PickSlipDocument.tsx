import { Barcode } from '@/components/Barcode'
import { formatDateWithWeekday } from '@/lib/formatDate'
import type { PickSlipRow } from '@/lib/queries/pickSlip'

/** 80mm thermal slip, one per requested order (design approved separately). "auto" page height
 * lets the printer's continuous roll size each slip to its own content instead of a fixed sheet;
 * `break-after: page` on every slip but the last is what turns that into one physical cut per
 * order on a printer configured for auto-cut-per-page (the printer driver's own "Roll Paper / Auto
 * Cut" setting -- a one-time Windows printer-properties setting, not something this page controls). */
export const PICK_SLIP_PRINT_CSS = `
  .pick-slip-doc { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #0a0a0a; }
  .pick-slip { width: 80mm; box-sizing: border-box; padding: 4mm 5mm; break-after: page; }
  .pick-slip:last-child { break-after: auto; }
  .pick-slip-row { display: flex; align-items: baseline; gap: 6px; font-size: 13px; line-height: 1.55; }
  .pick-slip-label { font-weight: 700; white-space: nowrap; }
  .pick-slip-value { overflow-wrap: anywhere; }
  .no-print { display: none; }
  @media screen {
    body { background: #D9DCE1; }
    .pick-slip-doc { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; }
    .pick-slip { background: #FAFAF7; box-shadow: 0 2px 10px rgba(0,0,0,0.18); break-after: auto !important; }
    .no-print { display: block; }
  }
  @media print {
    @page { size: 80mm auto; margin: 0; }
  }
`

export function PickSlipDocument({ slips }: { slips: PickSlipRow[] }) {
  return (
    <div className="pick-slip-doc">
      {slips.length === 0 && <div className="no-print">No orders found for this assignment.</div>}
      {slips.map((s, i) => (
        <div className="pick-slip" key={s.orderId}>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 20, fontWeight: 800, textDecoration: 'underline', textUnderlineOffset: 3 }}>Picking Slip</div>
            <div style={{ fontSize: 12, color: '#4B5563', marginTop: 2 }}>
              Order {i + 1} of {slips.length}
            </div>
          </div>

          <div style={{ borderTop: '1px dashed #9CA3AF', margin: '8px 0 6px' }} />

          <div className="pick-slip-row">
            <span className="pick-slip-label">Transfer From&nbsp;:</span>
            <span className="pick-slip-value">{s.warehouseCode}</span>
          </div>
          <div className="pick-slip-row">
            <span className="pick-slip-label">To Store&nbsp;:</span>
            <span className="pick-slip-value">{s.storeCode}</span>
          </div>
          <div className="pick-slip-row">
            <span className="pick-slip-label">Refer&nbsp;:</span>
            <span className="pick-slip-value">{s.orderNo}</span>
          </div>
          <div className="pick-slip-row">
            <span className="pick-slip-label">Zone&nbsp;:</span>
            <span className="pick-slip-value">{s.zones.join(', ') || '—'}</span>
          </div>
          <div className="pick-slip-row">
            <span className="pick-slip-label">SKU&nbsp;:</span>
            <span className="pick-slip-value">{s.uniqueSkuCount}</span>
          </div>
          <div className="pick-slip-row">
            <span className="pick-slip-label">Picker&nbsp;:</span>
            <span className="pick-slip-value">{s.pickerName}</span>
          </div>
          <div className="pick-slip-row">
            <span className="pick-slip-label">Order Date&nbsp;:</span>
            <span className="pick-slip-value">{formatDateWithWeekday(s.orderDate)}</span>
          </div>

          <div style={{ marginTop: 10, marginBottom: 20, display: 'flex', justifyContent: 'center' }}>
            <Barcode value={s.orderNo} height={40} width={1.6} fontSize={14} />
          </div>
        </div>
      ))}
    </div>
  )
}
