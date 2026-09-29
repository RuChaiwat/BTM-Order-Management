import * as XLSX from 'xlsx'

/** Builds a single-sheet .xlsx workbook as a Buffer, ready to upload or send as a download --
 * `rows[0]` is expected to be the header row. Uses the same `xlsx` package already used to parse
 * uploaded order/location spreadsheets on import (src/lib/importers/parseSpreadsheet.ts); this is
 * just that library's write side. */
export function buildXlsxBuffer(sheetName: string, rows: (string | number)[][]): Buffer {
  const worksheet = XLSX.utils.aoa_to_sheet(rows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
