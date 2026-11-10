/** Picker Management bulk upload: the standard template's column headers, shared by the template
 * download (app/api/pickers/template), the browser-side parse (PickerManagementBoard) and the
 * server-side validation (app/api/pickers/import). Headers are matched case/space-insensitively
 * via col() from parseSpreadsheet, so they deliberately carry no "*" required marker (which would
 * break that match) -- required columns are spelled out on the template's Instructions sheet. */
export const PICKER_TEMPLATE_COLUMNS = {
  pickerId: 'Picker ID',
  nameTh: 'Name (TH)',
  nameEn: 'Name (EN)',
  employmentType: 'Employment Type',
  note: 'Note',
} as const

export const PICKER_TEMPLATE_HEADER = [
  PICKER_TEMPLATE_COLUMNS.pickerId,
  PICKER_TEMPLATE_COLUMNS.nameTh,
  PICKER_TEMPLATE_COLUMNS.nameEn,
  PICKER_TEMPLATE_COLUMNS.employmentType,
  PICKER_TEMPLATE_COLUMNS.note,
]

/** Upper bound on rows per upload -- far above a warehouse's real picker roster, just a guard
 * against someone uploading the wrong (huge) file. */
export const PICKER_IMPORT_MAX_ROWS = 2000

export interface PickerImportRow {
  rowNumber: number
  picker_id: string
  name_th: string
  name_en: string
  employment_type: string
  note: string
}

export interface PickerImportError {
  rowNumber: number
  message: string
}
