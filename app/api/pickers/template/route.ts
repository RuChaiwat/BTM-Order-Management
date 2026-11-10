import { NextResponse } from 'next/server'
import * as XLSX from 'xlsx'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { PICKER_TEMPLATE_HEADER } from '@/lib/pickerImport'

const ADMIN_ROLES = ['system_admin', 'warehouse_manager', 'supervisor']

/** Standard Excel template for Picker Management's bulk upload. Sheet 1 "Pickers" is the one the
 * upload reads (header row only, ready to fill in); "Employment Types" lists the valid values,
 * read live from picker_employment_types so it always matches Configuration; "Instructions"
 * explains each column in Thai and English. */
export async function GET() {
  try {
    await requireRole(ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const admin = createAdminClient()
  const { data: types } = await admin.from('picker_employment_types').select('type_code, label_en, label_th').eq('active', true).order('type_code')

  const workbook = XLSX.utils.book_new()

  const pickers = XLSX.utils.aoa_to_sheet([PICKER_TEMPLATE_HEADER])
  pickers['!cols'] = [{ wch: 14 }, { wch: 32 }, { wch: 32 }, { wch: 20 }, { wch: 40 }]
  XLSX.utils.book_append_sheet(workbook, pickers, 'Pickers')

  const typeSheet = XLSX.utils.aoa_to_sheet([
    ['Employment Type (use this code)', 'Label (EN)', 'Label (TH)'],
    ...(types ?? []).map((t) => [t.type_code, t.label_en, t.label_th ?? '']),
  ])
  typeSheet['!cols'] = [{ wch: 30 }, { wch: 28 }, { wch: 28 }]
  XLSX.utils.book_append_sheet(workbook, typeSheet, 'Employment Types')

  const instructions = XLSX.utils.aoa_to_sheet([
    ['Column', 'Required', 'คำอธิบาย', 'Description'],
    ['Picker ID', 'Yes / ต้องกรอก', 'รหัสพนักงานตามบัตร ไม่เกิน 10 ตัวอักษร (A-Z, 0-9, - หรือ _) · ถ้ามีอยู่แล้วในระบบ = แก้ไขข้อมูลคนเดิม · ถ้ายังไม่มี = เพิ่มคนใหม่ (Active)', 'Employee card ID, max 10 characters (A-Z, 0-9, - or _). Existing ID = update that picker; new ID = create a new active picker.'],
    ['Name (TH)', 'Yes / ต้องกรอก', 'ชื่อ-นามสกุลภาษาไทย', 'Thai full name'],
    ['Name (EN)', 'No / ไม่บังคับ', 'ชื่อภาษาอังกฤษ · เว้นว่าง = คนใหม่ใช้ชื่อไทยแทน, คนเดิมคงค่าเดิม', 'English name. Blank: new picker uses the Thai name; existing picker keeps its current value.'],
    ['Employment Type', 'Yes / ต้องกรอก', 'ใส่รหัสหรือชื่อจากชีต Employment Types', 'A code or label from the Employment Types sheet'],
    ['Note', 'No / ไม่บังคับ', 'หมายเหตุ · เว้นว่าง = คนเดิมคงค่าเดิม', 'Free text. Blank: existing picker keeps its current note.'],
    [],
    ['กติกา / Rules'],
    ['1', '', 'กรอกข้อมูลในชีต Pickers เท่านั้น อย่าเปลี่ยนชื่อหัวคอลัมน์', 'Fill in the Pickers sheet only; do not rename the header row.'],
    ['2', '', 'ถ้ามีแถวใดผิด ระบบจะไม่นำเข้าทั้งไฟล์ และแสดงแถวที่ต้องแก้ — แก้แล้ว upload ใหม่ทั้งไฟล์', 'If any row is invalid nothing is imported; fix the listed rows and upload the whole file again.'],
    ['3', '', 'การเปิด/ปิดใช้งาน (Active/Inactive) และการลบ ทำที่หน้าจอ Picker Management เท่านั้น', 'Activate/deactivate and delete are done on the Picker Management screen, not by upload.'],
    ['4', '', 'พนักงานใหม่จะถูกเพิ่มเข้าคลังของผู้ที่ upload', "New pickers are added to the uploader's own warehouse."],
  ])
  instructions['!cols'] = [{ wch: 18 }, { wch: 16 }, { wch: 70 }, { wch: 70 }]
  XLSX.utils.book_append_sheet(workbook, instructions, 'Instructions')

  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': 'attachment; filename="BTM_Picker_Upload_Template.xlsx"',
    },
  })
}
