import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'

// Same admin-role set as /api/pickers -- Employment Type is Picker master data, maintained from
// Configuration without a code deploy (migration 0033).
const ADMIN_ROLES = ['system_admin', 'warehouse_manager', 'supervisor']

export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { type_code, label_en, label_th } = await request.json()
  if (!type_code || !label_en) {
    return NextResponse.json({ error: 'type_code and label_en are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('picker_employment_types')
    .insert({ type_code, label_en, label_th: label_th ?? null, created_by: caller.user_id, updated_by: caller.user_id })
    .select()
    .single()

  if (error) {
    const message = error.code === '23505' ? 'That type code is already in use' : error.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  await writeAudit(admin, { userId: caller.user_id, action: 'picker_employment_type.create', entityType: 'picker_employment_types', entityId: data.type_code, after: data })
  return NextResponse.json({ type: data }, { status: 201 })
}

/** Edit label or activate/deactivate -- never hard-deletes (preserves pickers' FK reference to a
 * retired type, same "deactivate" convention as reason_master). */
export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { type_code, label_en, label_th, active } = await request.json()
  if (!type_code) return NextResponse.json({ error: 'type_code is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: before } = await admin.from('picker_employment_types').select('*').eq('type_code', type_code).single()

  const patch: Record<string, unknown> = { updated_by: caller.user_id, updated_at: new Date().toISOString() }
  if (label_en !== undefined) patch.label_en = label_en
  if (label_th !== undefined) patch.label_th = label_th
  if (active !== undefined) patch.active = active

  const { data: after, error } = await admin.from('picker_employment_types').update(patch).eq('type_code', type_code).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await writeAudit(admin, { userId: caller.user_id, action: 'picker_employment_type.update', entityType: 'picker_employment_types', entityId: type_code, before, after })
  return NextResponse.json({ type: after })
}
