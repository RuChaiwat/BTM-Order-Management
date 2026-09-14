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
 * cellDates + raw:true (rather than the previous raw:false) so a genuine Excel date cell comes
 * back as an actual Date computed from the workbook's real stored value, not a re-formatted
 * display string. The previous raw:false asked SheetJS for the cell's *formatted display text*
 * for every cell, dates included -- which depends on SheetJS's own interpretation of the cell's
 * number-format code, and isn't guaranteed to match what a given Excel client happens to render
 * on screen for the same file (a locale/format-code mismatch, not a parsing bug in this app's own
 * date regex). A DD/MM/YYYY value like 13/09/2026 that isn't ambiguous (day > 12) still parsed
 * correctly either way, which is why a single-cell sample alone couldn't show this. */
export async function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: true })
  return rows.map((row) => {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[key.trim()] = value instanceof Date ? formatCellDate(value) : String(value ?? '').trim()
    }
    return normalized
  })
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
