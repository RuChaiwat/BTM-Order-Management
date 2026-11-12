import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'
import { getPackIssueDetail } from '@/lib/queries/packing'
import { PACK_ROOT_CAUSES } from '@/lib/packing'

const PACK_ADMIN_ROLES = ['system_admin', 'pack_supervisor']

export async function GET(_request: Request, { params }: { params: { issueId: string } }) {
  try {
    await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const detail = await getPackIssueDetail(createAdminClient(), params.issueId)
  if (!detail) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
  return NextResponse.json(detail, { headers: { 'Cache-Control': 'no-store' } })
}

/**
 * action 'acknowledge' -- "รับเรื่อง": open -> investigating, records who took it (clears the
 *   pop-up for every other supervisor).
 * action 'resolve' -- records root cause + note, optionally corrects the reported quantities, and
 *   either closes it by admin (order -> packed, i.e. on to Admin Pack Verify; the packer keeps the
 *   productivity credit minus the problem pieces) or returns the order to the pack queue (pending)
 *   for anyone to pack again.
 */
export async function POST(request: Request, { params }: { params: { issueId: string } }) {
  let caller
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const body = (await request.json()) as {
    action?: string
    root_cause?: string
    resolution?: 'closed_by_admin' | 'returned_to_pack'
    note?: string
    line_qty?: Record<string, number>
  }
  const admin = createAdminClient()
  const { data: issue } = await admin.from('pack_issues').select('*').eq('issue_id', params.issueId).maybeSingle()
  if (!issue) return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
  if (caller.warehouse_code && issue.warehouse_code && issue.warehouse_code !== caller.warehouse_code) {
    return NextResponse.json({ error: 'This issue belongs to another warehouse' }, { status: 403 })
  }

  if (body.action === 'acknowledge') {
    const { data: row } = await admin
      .from('pack_issues')
      .update({ status: 'investigating', acknowledged_by: caller.user_id, acknowledged_at: new Date().toISOString() })
      .eq('issue_id', issue.issue_id)
      .eq('status', 'open')
      .select('issue_id')
      .maybeSingle()
    if (!row) return NextResponse.json({ error: 'มีคนรับเรื่องนี้ไปแล้ว · Already taken by someone else' }, { status: 409 })
    await writeAudit(admin, { userId: caller.user_id, action: 'pack_issue.acknowledge', entityType: 'pack_issues', entityId: issue.issue_id })
    return NextResponse.json({ ok: true })
  }

  if (body.action !== 'resolve') return NextResponse.json({ error: "action must be 'acknowledge' or 'resolve'" }, { status: 400 })
  if (issue.status === 'resolved') return NextResponse.json({ error: 'เรื่องนี้ปิดไปแล้ว · Already resolved' }, { status: 409 })
  if (!body.root_cause || !PACK_ROOT_CAUSES.some((r) => r.code === body.root_cause)) return NextResponse.json({ error: 'เลือกสาเหตุจริง · Choose a root cause' }, { status: 400 })
  if (body.resolution !== 'closed_by_admin' && body.resolution !== 'returned_to_pack') return NextResponse.json({ error: 'resolution is required' }, { status: 400 })

  // Optional quantity corrections, validated before anything is written.
  const corrections = Object.entries(body.line_qty ?? {})
  const { data: lines } = await admin.from('pack_issue_lines').select('id, qty').eq('issue_id', issue.issue_id)
  const lineIds = new Set((lines ?? []).map((l) => l.id))
  for (const [id, qty] of corrections) {
    if (!lineIds.has(id)) return NextResponse.json({ error: 'Unknown issue line' }, { status: 400 })
    if (!Number.isInteger(qty) || qty < 1) return NextResponse.json({ error: 'จำนวนที่มีปัญหาต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป' }, { status: 400 })
  }

  const newPackStatus = body.resolution === 'closed_by_admin' ? 'packed' : 'pending'
  const { data: flipped } = await admin.from('orders').update({ pack_status: newPackStatus }).eq('order_id', issue.order_id).eq('pack_status', 'issue').select('order_id').maybeSingle()
  if (!flipped) return NextResponse.json({ error: 'สถานะ order เปลี่ยนไปแล้ว รีเฟรชแล้วลองใหม่ · Order status changed' }, { status: 409 })

  for (const [id, qty] of corrections) await admin.from('pack_issue_lines').update({ qty }).eq('id', id)
  if (issue.session_id) {
    const { data: fresh } = await admin.from('pack_issue_lines').select('qty').eq('issue_id', issue.issue_id)
    await admin
      .from('pack_sessions')
      .update({ issue_pieces: (fresh ?? []).reduce((s, l) => s + Number(l.qty), 0) })
      .eq('session_id', issue.session_id)
  }

  const now = new Date().toISOString()
  await admin
    .from('pack_issues')
    .update({
      status: 'resolved',
      root_cause: body.root_cause,
      resolution: body.resolution,
      resolution_note: body.note?.trim() || null,
      resolved_by: caller.user_id,
      resolved_at: now,
      acknowledged_by: issue.acknowledged_by ?? caller.user_id,
      acknowledged_at: issue.acknowledged_at ?? now,
    })
    .eq('issue_id', issue.issue_id)

  await writeStatusHistory(admin, { entityType: 'order_pack', entityId: issue.order_id, oldStatus: 'issue', newStatus: newPackStatus, changedBy: caller.user_id, reason: `${body.resolution}: ${body.root_cause}` })
  await writeAudit(admin, { userId: caller.user_id, action: 'pack_issue.resolve', entityType: 'pack_issues', entityId: issue.issue_id, before: issue, after: { root_cause: body.root_cause, resolution: body.resolution, note: body.note, line_qty: body.line_qty } })
  return NextResponse.json({ pack_status: newPackStatus })
}
