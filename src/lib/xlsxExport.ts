import * as XLSX from 'xlsx'

export interface XlsxSheet {
  name: string
  rows: (string | number)[][]
}

/** Builds a multi-sheet .xlsx workbook as a Buffer, ready to upload or send as a download -- each
 * sheet's `rows[0]` is expected to be its header row. Uses the same `xlsx` package already used to
 * parse uploaded order/location spreadsheets on import (src/lib/importers/parseSpreadsheet.ts);
 * this is just that library's write side. */
export function buildXlsxBuffer(sheets: XlsxSheet[]): Buffer {
  const workbook = XLSX.utils.book_new()
  for (const sheet of sheets) {
    const worksheet = XLSX.utils.aoa_to_sheet(sheet.rows)
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet.name)
  }
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}
