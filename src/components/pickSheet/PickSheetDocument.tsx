import { Barcode } from '@/components/Barcode'
import { formatDateWithWeekday } from '@/lib/formatDate'
import type { PickSheetRow, PickSheetLine } from '@/lib/queries/pickSheet'

/** A5 sheet, one (or more, if the line count overflows) per requested order -- item list sorted by
 * Picking Sequence, grouped into Zone bands for display. "Order Consolidation" and Pick Slip are
 * this document's siblings in Print & Reprint, each their own component/print size; this one isn't
 * reused for either. */
export const PICK_SHEET_PRINT_CSS = `
  .pick-sheet-doc { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; color: #141414; }
  .pick-sheet-page { width: 148mm; height: 210mm; box-sizing: border-box; padding: 9mm; break-after: page; display: flex; flex-direction: column; gap: 10px; }
  .pick-sheet-page:last-child { break-after: auto; }
  .no-print { display: none; }
  @media screen {
    body { background: #D9DCE1; }
    .pick-sheet-doc { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 24px 0; }
    .pick-sheet-page { background: #ffffff; box-shadow: 0 2px 10px rgba(0,0,0,0.18); break-after: auto !important; }
    .no-print { display: block; }
  }
  @media print {
    @page { size: A5; margin: 0; }
  }
`

// Matches the printed layout validated in the design review: ~18 item rows comfortably fit one A5
// page alongside the header/footer chrome. Zone heading bands aren't counted against this budget
// (they're a couple of px tall) -- an order with an unusually high number of zone transitions in a
// short run may print very slightly tighter than this, which is an acceptable real-world variance
// for a print layout, not a bug.
const ROWS_PER_PAGE = 18

type PageUnit = { kind: 'zone'; zone: string; continued: boolean } | { kind: 'line'; line: PickSheetLine; seq: number }

/** Groups consecutive same-zone lines under one heading band and slices the result into print
 * pages of up to ROWS_PER_PAGE item rows each. When a page break falls in the middle of a zone's
 * run, the zone heading repeats at the top of the next page with a "(CONT'D)" suffix so the sheet
 * never looks like it silently changed zone mid-page. */
function paginate(lines: PickSheetLine[]): PageUnit[][] {
  const units: PageUnit[] = []
  let lastZone: string | null = null
  lines.forEach((line, i) => {
    if (line.zoneCode !== lastZone) {
      units.push({ kind: 'zone', zone: line.zoneCode, continued: false })
      lastZone = line.zoneCode
    }
    units.push({ kind: 'line', line, seq: i + 1 })
  })

  const pages: PageUnit[][] = []
  let current: PageUnit[] = []
  let rowsOnPage = 0
  let openZone: string | null = null

  for (const unit of units) {
    if (unit.kind === 'zone') {
      openZone = unit.zone
      current.push(unit)
      continue
    }
    if (rowsOnPage >= ROWS_PER_PAGE) {
      pages.push(current)
      current = openZone ? [{ kind: 'zone', zone: openZone, continued: true }] : []
      rowsOnPage = 0
    }
    current.push(unit)
    rowsOnPage += 1
  }
  if (current.length > 0) pages.push(current)
  return pages.length > 0 ? pages : [[]]
}

export function PickSheetDocument({ sheets, generatedAt }: { sheets: PickSheetRow[]; generatedAt: string }) {
  return (
    <div className="pick-sheet-doc">
      {sheets.length === 0 && <div className="no-print">No orders found for this print job.</div>}
      {sheets.map((s, sheetIndex) => {
        const pages = paginate(s.lines)
        return pages.map((pageUnits, pageIndex) => {
          const isLastPageOfOrder = pageIndex === pages.length - 1
          const totalPieces = s.lines.reduce((sum, l) => sum + l.qty, 0)
          const uniqueSkus = new Set(s.lines.map((l) => l.sku)).size

          return (
            <div className="pick-sheet-page" key={`${s.orderId}-${pageIndex}`}>
              {/* Header -- identical on every page of every order */}
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 20, fontWeight: 800, letterSpacing: 0.3 }}>PICK SHEET</div>
                  <div style={{ fontSize: 10.5, color: '#6b6b6b', marginTop: 1 }}>ใบเบิกสินค้า</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <Barcode value={s.orderNo} height={28} width={1.4} fontSize={12} />
                </div>
              </div>

              <div style={{ height: 2, background: '#141414' }} />

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', rowGap: 4, columnGap: 16, fontSize: 11 }}>
                <div>
                  <span style={{ color: '#6b6b6b' }}>Transfer From:</span> <span style={{ fontWeight: 700 }}>{s.warehouseCode}</span>
                </div>
                <div>
                  <span style={{ color: '#6b6b6b' }}>To Store:</span> <span style={{ fontWeight: 700 }}>{s.storeCode}</span>
                </div>
                <div>
                  <span style={{ color: '#6b6b6b' }}>Order Date:</span> <span style={{ fontWeight: 700 }}>{formatDateWithWeekday(s.orderDate)}</span>
                </div>
                <div>
                  <span style={{ color: '#6b6b6b' }}>Picker:</span> <span style={{ fontWeight: 700 }}>{s.pickerName}</span>
                </div>
              </div>

              {/* Table */}
              <div style={{ marginTop: 2, flex: 1, minHeight: 0 }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '22px 62px 66px minmax(0,1fr) 52px 42px',
                    fontSize: 8.5,
                    fontWeight: 800,
                    letterSpacing: 0.4,
                    borderBottom: '2px solid #141414',
                    paddingBottom: 4,
                  }}
                >
                  <div>#</div>
                  <div>BIN</div>
                  <div>SKU</div>
                  <div>ITEM DESCRIPTION</div>
                  <div style={{ textAlign: 'right' }}>QTY</div>
                  <div style={{ textAlign: 'center' }}>PICK</div>
                </div>

                {pageUnits.map((u) =>
                  u.kind === 'zone' ? (
                    <div key={`zone-${u.zone}-${u.continued}`} style={{ background: '#f0f0f0', padding: '2px 4px', fontSize: 9.5, fontWeight: 800, marginTop: 5 }}>
                      ZONE {u.zone}
                      {u.continued ? " (CONT'D)" : ''}
                    </div>
                  ) : (
                    <div
                      key={u.line.lineId}
                      style={{ display: 'grid', gridTemplateColumns: '22px 62px 66px minmax(0,1fr) 52px 42px', fontSize: 9.5, padding: '3.5px 0', borderBottom: '1px solid #ddd', alignItems: 'center' }}
                    >
                      <div>{u.seq}</div>
                      <div>{u.line.binCode}</div>
                      <div>{u.line.sku}</div>
                      <div style={{ paddingRight: 6 }}>{u.line.itemDescription ?? '—'}</div>
                      <div style={{ textAlign: 'right', fontWeight: 700 }}>
                        {u.line.qty} {u.line.uomCode}
                      </div>
                      <div style={{ display: 'flex', justifyContent: 'center' }}>
                        <span style={{ display: 'inline-block', width: 11, height: 11, border: '1.3px solid #141414', borderRadius: 2 }} />
                      </div>
                    </div>
                  ),
                )}
              </div>

              {/* Footer -- signature + page number on every page; running totals + Time Completed
                  only on an order's last page */}
              <div style={{ marginTop: 'auto', paddingTop: 8, borderTop: '1px solid #141414' }}>
                {isLastPageOfOrder && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, marginBottom: 8 }}>
                    <div>
                      Total: {s.lines.length} lines ({uniqueSkus} SKU)
                    </div>
                    <div>{totalPieces} pcs</div>
                  </div>
                )}
                <div style={{ display: 'grid', gridTemplateColumns: isLastPageOfOrder ? 'repeat(2, minmax(0,1fr)) auto' : '1fr auto', alignItems: 'flex-end', gap: 16 }}>
                  <div>
                    <div style={{ borderBottom: '1px solid #141414', height: 16 }} />
                    <div style={{ marginTop: 3, fontSize: 9.5, color: '#6b6b6b' }}>Picker Signature</div>
                  </div>
                  {isLastPageOfOrder && (
                    <div>
                      <div style={{ borderBottom: '1px solid #141414', height: 16 }} />
                      <div style={{ marginTop: 3, fontSize: 9.5, color: '#6b6b6b' }}>Time Completed</div>
                    </div>
                  )}
                  <div style={{ fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>
                    Page {pageIndex + 1} of {pages.length}
                  </div>
                </div>
                <div style={{ fontSize: 8.5, color: '#9a9a9a', marginTop: 6 }}>Printed {generatedAt}</div>
              </div>
            </div>
          )
        })
      })}
    </div>
  )
}
