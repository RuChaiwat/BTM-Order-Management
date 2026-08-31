import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** Step 1 of the chunked order import flow (see OrderImportForm): creates the import_batches
 * row up front so start/batch/finish all reference the same import_id. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'planner_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { file_name, total_rows } = await request.json()
  if (!file_name || typeof total_rows !== 'number') {
    return NextResponse.json({ error: 'file_name and total_rows are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: importBatch, error } = await admin
    .from('import_batches')
    .insert({ file_name, uploaded_by: caller.user_id, status: 'validating', total_rows })
    .select('import_id')
    .single()
  if (error || !importBatch) return NextResponse.json({ error: error?.message ?? 'Failed to create import batch' }, { status: 500 })

  return NextResponse.json({ import_id: importBatch.import_id })
}
