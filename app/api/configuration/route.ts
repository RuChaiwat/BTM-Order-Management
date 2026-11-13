import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { PACKING_LONG_SESSION_DEFAULT, PACKING_LONG_SESSION_KEY, PACKING_RED_DEFAULT, PACKING_RED_KEY } from '@/lib/configCatalog'

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
  if (!key || value === undefined) {
    return NextResponse.json({ error: 'key and value are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const effectiveScope = scope ?? 'global'

  // Packing time bands: red must start after yellow, so the three colours never overlap or leave a gap.
  if (key === PACKING_LONG_SESSION_KEY || key === PACKING_RED_KEY) {
    const otherKey = key === PACKING_RED_KEY ? PACKING_LONG_SESSION_KEY : PACKING_RED_KEY
    const { data: other } = await admin.from('configuration').select('value').eq('key', otherKey).eq('scope', effectiveScope).eq('active', true).maybeSingle()
    const otherVal = Number(other?.value ?? (otherKey === PACKING_RED_KEY ? PACKING_RED_DEFAULT : PACKING_LONG_SESSION_DEFAULT))
    const yellow = key === PACKING_LONG_SESSION_KEY ? Number(value) : otherVal
    const red = key === PACKING_RED_KEY ? Number(value) : otherVal
    if (!(red > yellow)) {
      return NextResponse.json({ error: `สีแดง (${red} นาที) ต้องมากกว่าสีเหลือง (${yellow} นาที) · Red must be more than yellow` }, { status: 400 })
    }
  }
  const reason = change_reason || 'Updated from Configuration settings'

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
    .insert({ key, value, scope: effectiveScope, version: nextVersion, active: true, changed_by: caller.user_id, change_reason: reason })
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
