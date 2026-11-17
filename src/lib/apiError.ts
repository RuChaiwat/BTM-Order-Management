/**
 * User-facing error text is Thai only (client rule). Database / Supabase errors are technical
 * English, so they are never shown as-is: the detail goes to the server log and the user gets a
 * plain Thai message that says what to do next.
 */

export const DB_ERROR_TH = 'บันทึกหรืออ่านข้อมูลไม่สำเร็จ กรุณาลองใหม่ ถ้ายังไม่ได้ให้แจ้ง Admin'

type ErrorLike = { message?: string; code?: string } | null | undefined

/** Thai message for a database / Supabase error; logs the technical detail for troubleshooting. */
export function dbErrorTh(error: ErrorLike, context?: string): string {
  const message = error?.message ?? ''
  console.error(`[db-error]${context ? ` ${context}:` : ''}`, error?.code ?? '', message)
  // Raised by the assignment triggers (migrations 0006 / 0027).
  if (message.includes('is Cancelled and cannot be Assigned')) return 'มี Order ที่ถูกยกเลิกแล้ว มอบหมายงานไม่ได้ กรุณารีเฟรชแล้วลองใหม่'
  if (message.includes('has no lines in Zone')) return 'มี Order ที่ไม่มีสินค้าใน Zone นี้ มอบหมายงานได้เฉพาะ Order ที่อยู่ใน Zone และคลังเดียวกัน'
  // Supabase Auth (create user).
  if (/already (been )?registered|already exists/i.test(message)) return 'ข้อมูลนี้มีอยู่แล้วในระบบ'
  if (/password should be at least (\d+)/i.test(message)) return `รหัสผ่านต้องมีอย่างน้อย ${message.match(/at least (\d+)/i)?.[1]} ตัวอักษร`
  switch (error?.code) {
    case '23505':
      return 'ข้อมูลนี้มีอยู่แล้วในระบบ (ซ้ำ)'
    case '23503':
      return 'ข้อมูลนี้ถูกใช้งานอยู่ หรืออ้างอิงข้อมูลที่ไม่มีในระบบ'
    case '23502':
    case '23514':
    case '22P02':
      return 'ข้อมูลที่กรอกไม่ถูกต้องหรือไม่ครบ กรุณาตรวจสอบแล้วลองใหม่'
  }
  return DB_ERROR_TH
}

/** Order status in Thai for messages (the enum values are internal codes). */
const ORDER_STATUS_TH: Record<string, string> = {
  new: 'รอมอบหมายงาน',
  assigned: 'มอบหมายงานแล้ว',
  in_progress: 'กำลังหยิบ',
  picker_completed_100: 'Picker ยืนยันเสร็จ (ครบ)',
  picker_completed_short: 'Picker ยืนยันเสร็จ (ขาด)',
  waiting_admin_verification: 'รอ Admin ตรวจสอบ',
  admin_rejected: 'Admin ส่งกลับแก้ไข',
  correction_in_progress: 'กำลังแก้ไข',
  final_closed_100: 'ปิดงานแล้ว (ครบ)',
  final_closed_short: 'ปิดงานแล้ว (ขาด)',
  cancelled: 'ยกเลิกแล้ว',
}

export function orderStatusTh(status: string | null | undefined): string {
  return (status && ORDER_STATUS_TH[status]) || status || '—'
}
