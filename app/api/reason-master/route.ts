import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'

/** §17.1 Short Pick / Cancel Reason master — maintainable without a code deployment. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { reason_code, reason_type, label_en, label_th } = await request.json()
  if (!reason_code || !reason_type || !label_en) {
    return NextResponse.json({ error: 'reason_code, reason_type and label_en are required' }, { status: 400 })
  }
  if (!['short_pick', 'cancel'].includes(reason_type)) {
    return NextResponse.json({ error: "reason_type must be 'short_pick' or 'cancel'" }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('reason_master')
    .insert({ reason_code, reason_type, label_en, label_th: label_th ?? null, created_by: caller.user_id, updated_by: caller.user_id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await writeAudit(admin, { userId: caller.user_id, action: 'reason_master.create', entityType: 'reason_master', entityId: data.reason_code, after: data })
  return NextResponse.json({ reason: data }, { status: 201 })
}

/** Edit label or activate/deactivate — never hard-deletes (§17.1 "deactivate", preserves referential history). */
export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { reason_code, label_en, label_th, active } = await request.json()
  if (!reason_code) return NextResponse.json({ error: 'reason_code is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: before } = await admin.from('reason_master').select('*').eq('reason_code', reason_code).single()

  const patch: Record<string, unknown> = { updated_by: caller.user_id, updated_at: new Date().toISOString() }
  if (label_en !== undefined) patch.label_en = label_en
  if (label_th !== undefined) patch.label_th = label_th
  if (active !== undefined) patch.active = active

  const { data: after, error } = await admin.from('reason_master').update(patch).eq('reason_code', reason_code).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await writeAudit(admin, { userId: caller.user_id, action: 'reason_master.update', entityType: 'reason_master', entityId: reason_code, before, after })
  return NextResponse.json({ reason: after })
}
