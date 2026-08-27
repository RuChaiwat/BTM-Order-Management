import { JWT } from 'google-auth-library'

/**
 * §20.1 weekly Google Sheets export. Uses google-auth-library (JWT service-account auth) +
 * direct REST calls to the Sheets/Drive v4 APIs, rather than the full `googleapis` SDK — much
 * smaller bundle for a Vercel serverless function, same result.
 *
 * Untested against the live Google APIs in this build (no credentials, no network egress to
 * Google from the dev sandbox this was built in) — verify against a real service account and a
 * real Drive folder before relying on this in production. Fails loudly (throws, caught by the
 * caller and written to export_jobs.status='failed') rather than pretending to succeed if
 * GOOGLE_SERVICE_ACCOUNT_JSON is missing or malformed.
 */

function getAuthClient() {
  const json = process.env.GOOGLE_SERVICE_ACCOUNT_JSON
  if (!json) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set')
  const credentials = JSON.parse(json)
  return new JWT({
    email: credentials.client_email,
    key: credentials.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets', 'https://www.googleapis.com/auth/drive.file'],
  })
}

async function authedFetch(auth: JWT, url: string, init?: RequestInit) {
  const headers = await auth.getRequestHeaders()
  const res = await fetch(url, { ...init, headers: { ...headers, ...(init?.headers ?? {}), 'Content-Type': 'application/json' } })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Google API ${res.status}: ${body}`)
  }
  return res.json()
}

/** Creates a new spreadsheet directly inside `folderId` (§20.1: one new file per week, avoids
 * cell-limit growth in one long-running workbook). */
export async function createWeeklySpreadsheet(title: string, folderId: string): Promise<{ spreadsheetId: string; url: string }> {
  const auth = getAuthClient()

  const driveFile = await authedFetch(auth, 'https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    body: JSON.stringify({ name: title, mimeType: 'application/vnd.google-apps.spreadsheet', parents: [folderId] }),
  })

  return { spreadsheetId: driveFile.id, url: `https://docs.google.com/spreadsheets/d/${driveFile.id}` }
}

export async function writeSheetValues(spreadsheetId: string, range: string, values: (string | number)[][]) {
  const auth = getAuthClient()
  await authedFetch(
    auth,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    { method: 'PUT', body: JSON.stringify({ range, values }) },
  )
}
