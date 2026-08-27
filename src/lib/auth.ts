import { createClient } from './supabase/server'

export type AppUser = {
  user_id: string
  name_en: string
  name_th: string | null
  role: string
  warehouse_code: string | null
  zone_scope: string[]
}

/** Current signed-in user's employees_users row (role/scope), or null if not signed in / not provisioned. */
export async function getSessionUser(): Promise<AppUser | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('employees_users')
    .select('user_id, name_en, name_th, role, warehouse_code, zone_scope')
    .eq('auth_user_id', user.id)
    .eq('active', true)
    .maybeSingle()

  return (data as AppUser) ?? null
}

/** Throws if the current user's role isn't in `roles` — call at the top of a Route Handler. */
export async function requireRole(roles: string[]): Promise<AppUser> {
  const user = await getSessionUser()
  if (!user || !roles.includes(user.role)) {
    throw new Error(user ? `Role '${user.role}' is not permitted for this action` : 'Not signed in')
  }
  return user
}
