import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'

export interface PickerRow {
  picker_id: string
  name_en: string
  name_th: string | null
  warehouse_code: string | null
  zone_scope: string[]
  active: boolean
  shift_label: string | null
  note: string | null
  created_at: string
}

/** Full roster for the Picker Management page. `note` is purely informational (e.g. employee
 * type/distinction) -- never required, never used to look a picker up (see migration 0019). */
export async function getPickers(db: SupabaseClient, warehouseCode: string): Promise<PickerRow[]> {
  const res = await db
    .from('pickers')
    .select('picker_id, name_en, name_th, warehouse_code, zone_scope, active, shift_label, note, created_at')
    .eq('warehouse_code', warehouseCode)
    .order('picker_id')
  return unwrap(res)
}

/** Active pickers for the Work Assignment ID-scan input -- small enough (tens, not thousands)
 * to load whole and match client-side, same pattern as the existing order-barcode scan. Picker ID
 * is the sole identifier (see migration 0018) -- it's what's printed/scanned on the employee's own
 * ID card, not a separate assigned code. */
export async function getActivePickers(db: SupabaseClient, warehouseCode: string): Promise<PickerRow[]> {
  const res = await db
    .from('pickers')
    .select('picker_id, name_en, name_th, warehouse_code, zone_scope, active, shift_label, note, created_at')
    .eq('warehouse_code', warehouseCode)
    .eq('active', true)
    .order('name_en')
  return unwrap(res)
}
