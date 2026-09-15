import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

/** User Management now covers only login-having office/admin roles -- Pickers moved to their own
 * table with no login (migration 0015) and their own Picker Management page, so the 7-day
 * pcs/hr productivity join that used to live here (keyed off role='picker') no longer has
 * anything to match and was dropped rather than kept as permanently-dead computation. Picker
 * productivity is still available on Operations Dashboard and the Productivity page. */
export async function getWorkerData(db: SupabaseClient, warehouseCode: string) {
  const usersRes = await db
    .from('employees_users')
    .select('user_id, name_en, name_th, email, role, warehouse_code, zone_scope, active, shift_label, created_at')
    .eq('warehouse_code', warehouseCode)
    .order('user_id')

  return { users: unwrap(usersRes) }
}
