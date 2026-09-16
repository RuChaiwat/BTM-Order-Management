import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { isValidUserId, USER_ID_MAX_LENGTH } from '@/lib/authEmail'

// Same admin-role set as /api/users -- Pickers are master data, not self-service.
const ADMIN_ROLES = ['system_admin', 'warehouse_manager', 'supervisor']

/** Create a Picker: no Supabase Auth account, no login -- just a roster row identified by
 * Picker ID, which Work Assignment scans directly (from the employee's own ID card) to resolve a
 * name (see /api/assignments and WorkAssignmentBoard). A separate "Badge Code" was tried first
 * and dropped after UAT feedback: it read like an internal achievement badge, not an ID card
 * number, and having it differ from Picker ID was confusing in practice (migration 0018) -- this
 * is the entire reason Pickers were split out of employees_users (migration 0015): they must not
 * be able to log into the order management system at all. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const body = await request.json()
  const { picker_id, name_en, name_th, warehouse_code, zone_scope, shift_label } = body

  if (!picker_id || !name_en) {
    return NextResponse.json({ error: 'picker_id and name_en are required' }, { status: 400 })
  }
  if (!isValidUserId(picker_id)) {
    return NextResponse.json({ error: `picker_id must be 1-${USER_ID_MAX_LENGTH} characters (letters, numbers, - or _)` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: picker, error } = await admin
    .from('pickers')
    .insert({
      picker_id,
      name_en,
      name_th: name_th ?? null,
      warehouse_code: warehouse_code ?? null,
      zone_scope: zone_scope ?? [],
      shift_label: shift_label ?? null,
    })
    .select()
    .single()

  if (error) {
    const message = error.code === '23505' ? 'That Picker ID is already in use' : error.message
    return NextResponse.json({ error: message }, { status: 400 })
  }

  await writeAudit(admin, { userId: caller.user_id, action: 'picker.create', entityType: 'pickers', entityId: picker.picker_id, after: picker })

  return NextResponse.json({ picker }, { status: 201 })
}

/** Update a Picker's name, scope, or active status. */
export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const body = await request.json()
  const { picker_id, ...updates } = body
  if (!picker_id) {
    return NextResponse.json({ error: 'picker_id is required' }, { status: 400 })
  }

  const allowed = ['name_en', 'name_th', 'warehouse_code', 'zone_scope', 'active', 'shift_label']
  const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))

  const admin = createAdminClient()
  const { data: before } = await admin.from('pickers').select('*').eq('picker_id', picker_id).single()

  const { data: after, error } = await admin.from('pickers').update(patch).eq('picker_id', picker_id).select().single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await writeAudit(admin, { userId: caller.user_id, action: 'picker.update', entityType: 'pickers', entityId: picker_id, before, after })

  return NextResponse.json({ picker: after })
}

/** Remove a Picker. Blocked if they have any assignment history (assignment_batches.picker_id) --
 * deactivate instead of deleting to keep past assignments/productivity attributable to a name. */
export async function DELETE(request: Request) {
  let caller
  try {
    caller = await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { picker_id } = await request.json()
  if (!picker_id) {
    return NextResponse.json({ error: 'picker_id is required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { count } = await admin.from('assignment_batches').select('assignment_batch_id', { count: 'exact', head: true }).eq('picker_id', picker_id)
  if (count && count > 0) {
    return NextResponse.json({ error: `This Picker has ${count} assignment(s) on record — deactivate instead of deleting so that history stays attributable` }, { status: 400 })
  }

  const { data: before } = await admin.from('pickers').select('*').eq('picker_id', picker_id).single()
  const { error } = await admin.from('pickers').delete().eq('picker_id', picker_id)
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await writeAudit(admin, { userId: caller.user_id, action: 'picker.delete', entityType: 'pickers', entityId: picker_id, before })

  return NextResponse.json({ ok: true })
}
