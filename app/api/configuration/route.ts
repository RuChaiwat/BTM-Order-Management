import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'

/**
 * §17 governance: a config change creates a new version rather than mutating the active row —
 * old versions stay queryable (by version number) so batches created under them keep their
 * original rules. `config_version` on assignment_batches/consolidation_batches records which
 * version was active at creation time.
 */
export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { key, value, scope, change_reason } = await request.json()
  if (!key || value === undefined || !change_reason) {
    return NextResponse.json({ error: 'key, value and change_reason are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const effectiveScope = scope ?? 'global'

  const { data: current } = await admin
    .from('configuration')
    .select('*')
    .eq('key', key)
    .eq('scope', effectiveScope)
    .eq('active', true)
    .maybeSingle()

  const nextVersion = (current?.version ?? 0) + 1

  const { data: created, error: insertError } = await admin
    .from('configuration')
    .insert({ key, value, scope: effectiveScope, version: nextVersion, active: true, changed_by: caller.user_id, change_reason })
    .select()
    .single()
  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 })

  if (current) {
    await admin.from('configuration').update({ active: false }).eq('id', current.id)
  }

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'configuration.update',
    entityType: 'configuration',
    entityId: created.id,
    before: current,
    after: created,
  })

  return NextResponse.json({ configuration: created })
}
