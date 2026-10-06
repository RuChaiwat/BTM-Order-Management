import * as XLSX from 'xlsx'
import { stripLocationDashes } from '../locations/locationDisplay'

/** A genuine Excel date cell (with cellDates: true below) becomes a JS Date -- format it from its
 * UTC parts, not local time. SheetJS deliberately builds these Date objects so the calendar day
 * lands on UTC midnight regardless of the reading machine's timezone (its own docs recommend the
 * UTC getters for exactly this reason); reading local parts instead risks landing on the wrong day
 * printout of a UTC-minus timezone. */
function formatCellDate(d: Date): string {
  const y = d.getUTCFullYear()
  const m = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Reads one sheet into an array of row objects keyed by its own header row.
 *
 * cellDates:true (set by both callers below) so a genuine Excel date cell parses to an actual Date
 * computed from the workbook's real stored value, not a re-formatted display string (see
 * formatCellDate above for why that matters). But raw:true is deliberately NOT used for every cell
 * -- an earlier version did that, and it silently broke Bin Code / Order No matching for any WMS
 * export column that stores a business code as an Excel NUMBER with custom display formatting
 * (e.g. a bin code entered as 7 but displayed "007" via a leading-zero number format): raw:true
 * returned the underlying number (7) instead of the formatted text WMS actually shows and
 * Location Master was seeded from ("007"), so the two never matched.
 *
 * Reading cells directly (not via sheet_to_json's raw option) instead gets the best of both: a
 * true date cell (cell.v is a Date, only possible because of cellDates above) is formatted from
 * its own value, while every other cell uses its formatted display text (cell.w -- the same text
 * SheetJS would show if you opened the file), matching what the user sees in Excel. */
function sheetToRows(sheet: XLSX.WorkSheet): Record<string, string>[] {
  const ref = sheet['!ref']
  if (!ref) return []
  const range = XLSX.utils.decode_range(ref)

  const headers: string[] = []
  for (let c = range.s.c; c <= range.e.c; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: range.s.r, c })]
    headers[c] = String(cell?.w ?? cell?.v ?? '').trim()
  }

  const rows: Record<string, string>[] = []
  for (let r = range.s.r + 1; r <= range.e.r; r++) {
    const row: Record<string, string> = {}
    let hasValue = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c]
      if (!header) continue
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      let text = ''
      if (cell) {
        text = cell.v instanceof Date ? formatCellDate(cell.v) : String(cell.w ?? cell.v ?? '').trim()
        if (text !== '') hasValue = true
      }
      row[header] = text
    }
    if (hasValue) rows.push(row)
  }
  return rows
}

/** Case/whitespace-insensitive column lookup — WMS exports vary column casing/spacing. */
export function col(row: Record<string, string>, ...candidates: string[]): string {
  const keys = Object.keys(row)
  for (const candidate of candidates) {
    const match = keys.find((k) => k.toLowerCase().replace(/[\s._-]/g, '') === candidate.toLowerCase().replace(/[\s._-]/g, ''))
    if (match) return row[match]
  }
  return ''
}

function findSheet(workbook: XLSX.WorkBook, name: string): XLSX.WorkSheet | undefined {
  const normalize = (s: string) => s.toLowerCase().replace(/[\s._-]/g, '')
  const match = workbook.SheetNames.find((n) => normalize(n) === normalize(name))
  return match ? workbook.Sheets[match] : undefined
}

/** Parses an uploaded .csv/.xlsx File's FIRST sheet into an array of row objects keyed by header.
 * Used for single-flat-sheet imports (Location Master) — see parseWmsOrderWorkbook below for the
 * two-sheet WMS Transfer Order format, which is a different shape entirely and gets its own
 * parser rather than overloading this one. */
export async function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  if (!sheet) return []
  return sheetToRows(sheet)
}

/**
 * §5 WMS order import — the WMS's own Transfer Order export is two related sheets, not one flat
 * file: "Transfer List" (one row per order/Transfer, its own header-level fields) and "Warehouse
 * Pick Lines" (one row per order line, joined back to its order by Source No. <-> Transfer List's
 * own No.). This reads both, keeps only orders whose BT Status is "Picking" (any other status, or
 * no status, means the order isn't real picking work yet), and produces the same canonical flat
 * row shape processOrderRowsBatch already expects (one row per line, header fields carried onto
 * each of its lines) -- so the rest of the import pipeline (required-field validation, Location
 * Master join, batching/upsert) needs no changes at all.
 *
 * Both sheets are required; a workbook missing either (e.g. someone uploads just one sheet, or a
 * completely different file) is rejected outright with a clear error rather than silently reading
 * nothing, since there's no way to produce an order row without both.
 *
 * Bin Code arrives from WMS WITH the two display dashes (e.g. "A5J-08-A04") but
 * `locations.bin_code` (the join key this value is matched against) never has them -- stripped
 * here before the row is even returned, so the rest of the pipeline only ever sees the canonical
 * form (see src/lib/locations/locationDisplay.ts).
 */
export async function parseWmsOrderWorkbook(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })

  const transferSheet = findSheet(workbook, 'Transfer List')
  const pickLinesSheet = findSheet(workbook, 'Warehouse Pick Lines')
  if (!transferSheet || !pickLinesSheet) {
    const missing = [!transferSheet && '"Transfer List"', !pickLinesSheet && '"Warehouse Pick Lines"'].filter(Boolean).join(' and ')
    throw new Error(
      `This file is missing the required sheet(s): ${missing}. Expected a WMS Transfer Order export with both a "Transfer List" (order header) sheet and a "Warehouse Pick Lines" (order lines) sheet — found: ${workbook.SheetNames.join(', ') || '(no sheets)'}.`,
    )
  }

  const headerByOrderNo = new Map<string, { warehouseCode: string; storeCode: string; originalOrderDate: string }>()
  for (const row of sheetToRows(transferSheet)) {
    if (col(row, 'BT Status').trim().toLowerCase() !== 'picking') continue
    const orderNo = col(row, 'No.', 'No')
    if (!orderNo) continue
    headerByOrderNo.set(orderNo, {
      warehouseCode: col(row, 'Transfer-from Code'),
      storeCode: col(row, 'Transfer-to Code'),
      originalOrderDate: col(row, 'Posting Date'),
    })
  }

  const rows: Record<string, string>[] = []
  for (const row of sheetToRows(pickLinesSheet)) {
    const orderNo = col(row, 'Source No.', 'Source No')
    const header = orderNo ? headerByOrderNo.get(orderNo) : undefined
    // Not a Picking-status order (or not in Transfer List at all) -- excluded, not an error: this
    // is the file's own stated distinction between real picking work and everything else.
    if (!header) continue
    rows.push({
      Transfer: orderNo,
      'Warehouse Code': header.warehouseCode,
      'Shipment Date': header.originalOrderDate,
      'Store Code': header.storeCode,
      'Item No.': col(row, 'Item No.', 'Item No'),
      'SKU Barcode': col(row, 'Barcode'),
      'Bin Code': stripLocationDashes(col(row, 'Bin Code')),
      Quantity: col(row, 'Quantity'),
      'Unit of Measure Code': col(row, 'Unit of Measure Code', 'UOM'),
      Description: col(row, 'Description'),
    })
  }
  return rows
}

/** WMS dates observed as-is in sample exports; accepts YYYY-MM-DD or DD/MM/YYYY and normalizes to
 * ISO. Also strips a trailing time-of-day (some exports carry an otherwise-ISO date as
 * "2026-09-14 00:00:00" or "2026-09-14T00:00:00.000Z") -- this value is used as an exact-match
 * lookup/matching key against Postgres's own bare `date` serialization elsewhere in the import
 * pipeline, not just displayed, so two strings for the same calendar day must normalize identically
 * or every order in the file silently fails to match back up after being written. */
export function normalizeDate(value: string): string {
  const trimmed = value.trim()
  const isoWithTime = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ]/)
  if (isoWithTime) return isoWithTime[1]
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed
  const m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
  if (m) {
    const [, d, mo, y] = m
    return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
  }
  return trimmed
}

/** The grouping key used to chunk rows into orders — used both client-side (to batch an order's
 * lines together so they never split across two batch calls) and server-side (to group a batch's
 * rows back into orders before writing). Pure/isomorphic on purpose — safe to import from a
 * client component without pulling in any server-only DB code. */
export function orderGroupKey(row: Record<string, string>): string {
  const warehouseCode = col(row, 'Warehouse Code')
  const orderNo = col(row, 'Transfer', 'Order No')
  const originalOrderDate = normalizeDate(col(row, 'Shipment Date', 'Original Order Date'))
  return `${warehouseCode}|${orderNo}|${originalOrderDate}`
}
