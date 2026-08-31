import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** Lets the Order Pool / Location Master screens show what went wrong on a past import, not just
 * the error count — needed however long after the upload the user comes back to look. */
export async function GET(_request: Request, { params }: { params: { importId: string } }) {
  try {
    await requireRole(['system_admin', 'planner_admin', 'supervisor', 'warehouse_manager'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('import_errors')
    .select('error_id, row_number, error_reason, severity, created_at')
    .eq('import_id', params.importId)
    .order('row_number')
    .limit(500)
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json({ errors: data ?? [] })
}
