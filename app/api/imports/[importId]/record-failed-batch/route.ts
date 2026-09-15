import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Records rows from a batch call that failed outright (network error, serverless timeout, a
 * non-JSON error response) as blocking import_errors, so /finish's status/success_rows
 * reconciliation -- which deliberately only trusts what's actually in import_errors, not
 * client-reported counts -- reflects that these rows were never written. Without this, a batch
 * that fails before the server can insert its own error rows would leave zero trace in the DB,
 * and /finish would report "completed" even though a whole chunk of the file silently never made
 * it in (see OrderImportForm's per-batch try/catch).
 */
export async function POST(request: Request, { params }: { params: { importId: string } }) {
  try {
    await requireRole(['system_admin', 'planner_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { rows, reason } = (await request.json()) as { rows?: { rowNumber: number; data: Record<string, string> }[]; reason?: string }
  if (!Array.isArray(rows) || !reason) {
    return NextResponse.json({ error: 'rows[] and reason are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { error } = await admin.from('import_errors').insert(
    rows.map((r) => ({ import_id: params.importId, row_number: r.rowNumber, raw_data: r.data, error_reason: reason, severity: 'blocking' as const })),
  )
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
