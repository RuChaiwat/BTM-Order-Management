import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'

const PACK_ADMIN_ROLES = ['system_admin', 'pack_supervisor']

/** Pack issue reasons -- the dropdown on the Pack Handheld's Completed with Short form. Maintained
 * by the Pack Supervisor on Pack Settings; deactivate instead of delete (history references them). */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const body = await request.json()
  const code = String(body.reason_code ?? '').trim().toUpperCase()
  const labelTh = String(body.label_th ?? '').trim()
  const labelEn = String(body.label_en ?? '').trim() || labelTh
  if (!/^[A-Z0-9_-]{1,30}$/.test(code)) return NextResponse.json({ error: 'Code must be 1-30 characters (A-Z, 0-9, - or _) · รหัสไม่ถูกต้อง' }, { status: 400 })
  if (!labelTh) return NextResponse.json({ error: 'Thai label is required · ต้องกรอกชื่อปัญหา (ไทย)' }, { status: 400 })

  const admin = createAdminClient()
  const { data: last } = await admin.from('pack_issue_reasons').select('sort_order').order('sort_order', { ascending: false }).limit(1).maybeSingle()
  const { data, error } = await admin
    .from('pack_issue_reasons')
    .insert({ reason_code: code, label_th: labelTh, label_en: labelEn, sort_order: (last?.sort_order ?? 0) + 10, created_by: caller.user_id, updated_by: caller.user_id })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? `รหัส ${code} มีอยู่แล้ว · already exists` : error.message }, { status: 400 })

  await writeAudit(admin, { userId: caller.user_id, action: 'pack_issue_reason.create', entityType: 'pack_issue_reasons', entityId: code, after: data })
  return NextResponse.json({ reason: data }, { status: 201 })
}

export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const { reason_code, label_th, label_en, active } = await request.json()
  if (!reason_code) return NextResponse.json({ error: 'reason_code is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: before } = await admin.from('pack_issue_reasons').select('*').eq('reason_code', reason_code).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Reason not found' }, { status: 404 })

  const patch: Record<string, unknown> = { updated_by: caller.user_id, updated_at: new Date().toISOString() }
  if (typeof label_th === 'string') {
    if (!label_th.trim()) return NextResponse.json({ error: 'Thai label is required' }, { status: 400 })
    patch.label_th = label_th.trim()
  }
  if (typeof label_en === 'string' && label_en.trim()) patch.label_en = label_en.trim()
  if (typeof active === 'boolean') patch.active = active

  const { data: after, error } = await admin.from('pack_issue_reasons').update(patch).eq('reason_code', reason_code).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await writeAudit(admin, { userId: caller.user_id, action: 'pack_issue_reason.update', entityType: 'pack_issue_reasons', entityId: reason_code, before, after })
  return NextResponse.json({ reason: after })
}
