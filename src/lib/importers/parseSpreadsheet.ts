import * as XLSX from 'xlsx'

/** Parses an uploaded .csv/.xlsx File into an array of row objects keyed by header. */
export async function parseSpreadsheet(file: File): Promise<Record<string, string>[]> {
  const buffer = await file.arrayBuffer()
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false })
  return rows.map((row) => {
    const normalized: Record<string, string> = {}
    for (const [key, value] of Object.entries(row)) {
      normalized[key.trim()] = String(value ?? '').trim()
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
