import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { isValidUserId, USER_ID_MAX_LENGTH } from '@/lib/authEmail'
import { PICKER_IMPORT_MAX_ROWS, type PickerImportError, type PickerImportRow } from '@/lib/pickerImport'

const ADMIN_ROLES = ['system_admin', 'warehouse_manager', 'supervisor']

type PickerRecord = {
  picker_id: string
  name_en: string
  name_th: string | null
  employment_type: string | null
  note: string | null
  warehouse_code: string | null
  zone_scope: string[]
  active: boolean
  shift_label: string | null
}

/** Bulk create/update of Pickers from the standard Excel template (parsed in the browser, sent
 * here as rows). All-or-nothing by design: every row is validated first, and if ANY row is wrong
 * nothing is written and every problem row is returned -- the user fixes the file and re-uploads
 * it whole. Existing Picker ID = update that picker (blank optional columns keep their current
 * value); new Picker ID = create an active picker in the uploader's warehouse. Active/inactive is
 * never changed here (deactivation has its own pending-work guard on the screen). */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const body = await request.json()
  const rows = (body.rows ?? []) as PickerImportRow[]
  const warehouseCode: string | null = caller.warehouse_code ?? body.warehouse_code ?? null
  if (rows.length === 0) return NextResponse.json({ error: 'The Pickers sheet has no data rows · ไม่พบข้อมูลในชีต Pickers' }, { status: 400 })
  if (rows.length > PICKER_IMPORT_MAX_ROWS) {
    return NextResponse.json({ error: `Too many rows (${rows.length}) — max ${PICKER_IMPORT_MAX_ROWS} per upload` }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: types } = await admin.from('picker_employment_types').select('type_code, label_en, label_th').eq('active', true)
  // Employment Type may be given as its code or either label, any case.
  const typeByKey = new Map<string, string>()
  for (const t of types ?? []) {
    for (const k of [t.type_code, t.label_en, t.label_th]) if (k) typeByKey.set(String(k).trim().toLowerCase(), t.type_code)
  }

  const ids = rows.map((r) => r.picker_id.trim().toUpperCase()).filter(Boolean)
  const { data: existingRows, error: existingError } = ids.length
    ? await admin
        .from('pickers')
        .select('picker_id, name_en, name_th, employment_type, note, warehouse_code, zone_scope, active, shift_label')
        .in('picker_id', [...new Set(ids)])
    : { data: [] as PickerRecord[], error: null }
  if (existingError) return NextResponse.json({ error: existingError.message }, { status: 500 })
  const existingById = new Map((existingRows ?? []).map((p) => [p.picker_id, p as PickerRecord]))

  const errors: PickerImportError[] = []
  const seen = new Map<string, number>()
  const upserts: PickerRecord[] = []
  const created: string[] = []
  const updated: string[] = []

  for (const r of rows) {
    const rowErrors: string[] = []
    const pickerId = r.picker_id.trim().toUpperCase()
    const nameTh = r.name_th.trim()
    const nameEn = r.name_en.trim()
    const note = r.note.trim()
    const typeCode = typeByKey.get(r.employment_type.trim().toLowerCase())

    if (!pickerId) rowErrors.push('Picker ID is required · ต้องกรอก Picker ID')
    else if (!isValidUserId(pickerId)) rowErrors.push(`Picker ID "${pickerId}" must be 1-${USER_ID_MAX_LENGTH} characters (A-Z, 0-9, - or _)`)
    else if (seen.has(pickerId)) rowErrors.push(`Picker ID "${pickerId}" appears more than once in the file (also row ${seen.get(pickerId)}) · Picker ID ซ้ำในไฟล์`)
    if (!nameTh) rowErrors.push('Name (TH) is required · ต้องกรอกชื่อภาษาไทย')
    if (!r.employment_type.trim()) rowErrors.push('Employment Type is required · ต้องกรอกประเภทการจ้างงาน')
    else if (!typeCode) rowErrors.push(`Employment Type "${r.employment_type.trim()}" is not in the Employment Types list · ไม่พบประเภทการจ้างงานนี้`)

    const existing = pickerId ? existingById.get(pickerId) : undefined
    if (existing && warehouseCode && existing.warehouse_code && existing.warehouse_code !== warehouseCode) {
      rowErrors.push(`Picker ID "${pickerId}" belongs to warehouse ${existing.warehouse_code} · พนักงานคนนี้อยู่คลังอื่น`)
    }

    if (pickerId && !seen.has(pickerId)) seen.set(pickerId, r.rowNumber)
    if (rowErrors.length > 0) {
      errors.push({ rowNumber: r.rowNumber, message: rowErrors.join(' · ') })
      continue
    }

    if (existing) {
      // name_en mirrors the Thai name when it was never set separately (same rule as POST/PATCH),
      // so a Thai-name correction carries over instead of leaving a stale copy behind.
      const mirrored = !existing.name_en || existing.name_en === existing.name_th
      upserts.push({
        ...existing,
        name_th: nameTh,
        name_en: nameEn || (mirrored ? nameTh : existing.name_en),
        employment_type: typeCode!,
        note: note || existing.note,
      })
      updated.push(pickerId)
    } else {
      upserts.push({
        picker_id: pickerId,
        name_th: nameTh,
        name_en: nameEn || nameTh,
        employment_type: typeCode!,
        note: note || null,
        warehouse_code: warehouseCode,
        zone_scope: [],
        active: true,
        shift_label: null,
      })
      created.push(pickerId)
    }
  }

  if (errors.length > 0) {
    return NextResponse.json({ error: `${errors.length} row(s) need fixing — nothing was imported · มี ${errors.length} แถวต้องแก้ไข ยังไม่ได้นำเข้าข้อมูลใดๆ`, errors }, { status: 400 })
  }

  // One statement for every row -- either the whole file lands or none of it does.
  const { error: upsertError } = await admin.from('pickers').upsert(upserts, { onConflict: 'picker_id' })
  if (upsertError) return NextResponse.json({ error: `Import failed, nothing was saved: ${upsertError.message}` }, { status: 400 })

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'picker.import',
    entityType: 'pickers',
    entityId: null,
    after: { file_name: body.file_name ?? null, created, updated },
  })

  return NextResponse.json({ created: created.length, updated: updated.length })
}
