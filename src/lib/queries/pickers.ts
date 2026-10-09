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
  employment_type: string | null
  productivity_level: string | null
  productivity_pcs_per_hour: number | null
  productivity_updated_at: string | null
  created_at: string
}

export interface PickerEmploymentType {
  type_code: string
  label_en: string
  label_th: string | null
}

const PICKER_COLUMNS =
  'picker_id, name_en, name_th, warehouse_code, zone_scope, active, shift_label, note, employment_type, productivity_level, productivity_pcs_per_hour, productivity_updated_at, created_at'

/** Active Employment Type options for the Picker List badge + Add/Edit Picker dropdown
 * (migration 0033) -- configurable from Configuration without a code deploy. */
export async function getActiveEmploymentTypes(db: SupabaseClient): Promise<PickerEmploymentType[]> {
  const res = await db.from('picker_employment_types').select('type_code, label_en, label_th').eq('active', true).order('type_code')
  return unwrap(res)
}

/** Full roster for the Picker Management page. `note` is purely informational (e.g. employee
 * type/distinction) -- never required, never used to look a picker up (see migration 0019).
 * `productivity_*` is the weekly auto-computed rating (migration 0020) -- read-only, recomputed
 * every Sunday by /api/cron/picker-productivity, never set through this page's form. */
export async function getPickers(db: SupabaseClient, warehouseCode: string): Promise<PickerRow[]> {
  const res = await db.from('pickers').select(PICKER_COLUMNS).eq('warehouse_code', warehouseCode).order('picker_id')
  return unwrap(res)
}

/** Active pickers for the Work Assignment ID-scan input -- small enough (tens, not thousands)
 * to load whole and match client-side, same pattern as the existing order-barcode scan. Picker ID
 * is the sole identifier (see migration 0018) -- it's what's printed/scanned on the employee's own
 * ID card, not a separate assigned code. */
export async function getActivePickers(db: SupabaseClient, warehouseCode: string): Promise<PickerRow[]> {
  const res = await db.from('pickers').select(PICKER_COLUMNS).eq('warehouse_code', warehouseCode).eq('active', true).order('name_en')
  return unwrap(res)
}
