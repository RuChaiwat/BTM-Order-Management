import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The only way a browser ever reaches a file in the private `exports` Storage bucket (migration
 * 0029) -- gated the same as triggering the export itself (System Admin only), then mints a
 * short-lived signed URL for this one job's file and redirects to it, rather than the bucket (or
 * any file in it) ever being reachable on its own. Minted fresh on every click instead of storing
 * a signed URL in export_jobs.target_ref, which would otherwise expire and go stale while the job
 * history itself is kept indefinitely.
 */
export async function GET(request: Request, { params }: { params: { jobId: string } }) {
  try {
    await requireRole(['system_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: job } = await admin.from('export_jobs').select('status, control_totals').eq('id', params.jobId).maybeSingle()
  if (!job || job.status !== 'success') return NextResponse.json({ error: 'Export not found or not successful' }, { status: 404 })

  const storagePath = (job.control_totals as { storagePath?: string } | null)?.storagePath
  if (!storagePath) return NextResponse.json({ error: 'This export has no file on record' }, { status: 404 })

  const { data: signed, error } = await admin.storage.from('exports').createSignedUrl(storagePath, 60)
  if (error || !signed) return NextResponse.json({ error: error?.message ?? 'Could not create a download link' }, { status: 500 })

  return NextResponse.redirect(signed.signedUrl)
}
