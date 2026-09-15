import * as XLSX from 'xlsx'

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

/** Parses an uploaded .csv/.xlsx File into an array of row objects keyed by header.
 *
 * cellDates:true so a genuine Excel date cell parses to an actual Date computed from the
 * workbook's real stored value, not a re-formatted display string (see formatCellDate above for
 * why that matters). But raw:true is deliberately NOT passed to sheet_to_json for every cell --
 * an earlier version did that, and it silently broke Bin Code / Order No matching for any WMS
 * export column that stores a business code as an Excel NUMBER with custom display formatting
 * (e.g. a bin code entered as 7 but displayed "007" via a leading-zero number format): raw:true
 * returned the underlying number (7) instead of the formatted text WMS actually shows and
 * Location Master was seeded from ("007"), so the two never matched.
 *
 * Reading cells directly (not via sheet_to_json's raw option) instead gets the best of both: a
 * true date cell (cell.v is a Date, only possible because of cellDates above) is formatted from
 * its own value, while every other cell uses its formatted display text (cell.w -- the same text
 * SheetJS would show if you opened the file), matching what the user sees in Excel. */
export async function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
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
