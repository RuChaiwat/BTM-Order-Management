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
