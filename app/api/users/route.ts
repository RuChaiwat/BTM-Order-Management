import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { toAuthEmail, isValidUserId, USER_ID_MAX_LENGTH } from '@/lib/authEmail'

const VALID_ROLES = ['system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'zone_controller', 'picker', 'viewer']

/** Create a new user: Supabase Auth account + matching employees_users row, in one call.
 * Login is by User ID (§7), not email — `email` here is optional contact info only; the
 * Supabase Auth account itself uses a synthetic derived address (see src/lib/authEmail.ts). */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, email, password, name_en, name_th, role, warehouse_code, zone_scope, employee_id, shift_label } = body

  if (!user_id || !password || !name_en || !role) {
    return NextResponse.json({ error: 'user_id, password, name_en and role are required' }, { status: 400 })
  }
  if (!isValidUserId(user_id)) {
    return NextResponse.json({ error: `user_id must be 1-${USER_ID_MAX_LENGTH} characters (letters, numbers, - or _)` }, { status: 400 })
  }
  if (!VALID_ROLES.includes(role)) {
    return NextResponse.json({ error: `role must be one of ${VALID_ROLES.join(', ')}` }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email: toAuthEmail(user_id),
    password,
    email_confirm: true,
  })
  if (authError || !authUser.user) {
    return NextResponse.json({ error: authError?.message ?? 'Failed to create auth user' }, { status: 400 })
  }

  const { data: employee, error: employeeError } = await admin
    .from('employees_users')
    .insert({
      user_id,
      auth_user_id: authUser.user.id,
      employee_id: employee_id ?? null,
      name_en,
      name_th: name_th ?? null,
      email: email || null,
      role,
      warehouse_code: warehouse_code ?? null,
      zone_scope: zone_scope ?? [],
      shift_label: shift_label ?? null,
    })
    .select()
    .single()

  if (employeeError) {
    // roll back the auth user so we don't leave an orphaned account with no employees_users row
    await admin.auth.admin.deleteUser(authUser.user.id)
    return NextResponse.json({ error: employeeError.message }, { status: 400 })
  }

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'user.create',
    entityType: 'employees_users',
    entityId: employee.user_id,
    after: employee,
  })

  return NextResponse.json({ user: employee }, { status: 201 })
}

/** Update role/scope/active status for an existing user. */
export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const body = await request.json()
  const { user_id, ...updates } = body
  if (!user_id) {
    return NextResponse.json({ error: 'user_id is required' }, { status: 400 })
  }

  const allowed = ['role', 'warehouse_code', 'zone_scope', 'active', 'shift_label', 'name_en', 'name_th']
  const patch = Object.fromEntries(Object.entries(updates).filter(([k]) => allowed.includes(k)))

  const admin = createAdminClient()
  const { data: before } = await admin.from('employees_users').select('*').eq('user_id', user_id).single()

  const { data: after, error } = await admin.from('employees_users').update(patch).eq('user_id', user_id).select().single()
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'user.update',
    entityType: 'employees_users',
    entityId: user_id,
    before,
    after,
  })

  return NextResponse.json({ user: after })
}
