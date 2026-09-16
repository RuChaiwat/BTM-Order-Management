/** Shared display formatters — every date/timestamp shown to the user renders as DD/MM/YYYY (and
 * DD/MM/YYYY HH:mm for timestamps) in Thailand time (Asia/Bangkok), regardless of what timezone
 * the browser or the underlying DB value is in. Do NOT use these for values bound to an
 * `<input type="date">` — those need the raw ISO yyyy-mm-dd string. */

const DATE_FORMATTER = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Bangkok', day: '2-digit', month: '2-digit', year: 'numeric' })
const DATETIME_FORMATTER = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})
// en-CA conveniently formats as YYYY-MM-DD -- used only to BUCKET timestamps by Thailand calendar
// day (e.g. "is this completion from today?"), never for display.
const BANGKOK_DATE_KEY_FORMATTER = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' })

/** Bare calendar date -> "DD/MM/YYYY". Accepts a `date` or `timestamptz` column value. */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return DATE_FORMATTER.format(d)
}

/** Timestamp -> "DD/MM/YYYY HH:mm" in Thailand time. */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value)
  return DATETIME_FORMATTER.format(d).replace(',', '')
}

/** YYYY-MM-DD for the given instant, in Thailand time -- for bucketing/comparing timestamps by
 * calendar day (e.g. "is this completion from today?"). Not for display -- use formatDate. */
export function bangkokDateKey(value: string | Date | null | undefined): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  return BANGKOK_DATE_KEY_FORMATTER.format(d)
}
