import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit, writeStatusHistory } from '@/lib/audit'

interface LineInput {
  line_id: string
  picked_qty: number
  short_reason_code?: string | null
  remark?: string | null
}

/**
 * §12.3 Admin Verification redesign: the picker only reported a coarse result (§12.2 -- no
 * per-line detail), so Final Close now itemizes every order line here instead, checked against the
 * real WMS confirmation -- the same validation that used to live in the picker's own submission
 * (app/api/picker-completions/route.ts) before this redesign moved it to Admin. actual_pieces and
 * result are derived from `lines`, not trusted from the client, and become the order's authoritative
 * final numbers (superseding whatever the picker's own coarse completion guessed). Reject is
 * unchanged: no line detail needed, just a reason, and the order goes back for the picker to redo.
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { order_id, decision, lines, reject_reason } = (await request.json()) as {
    order_id?: string
    decision?: 'final_close' | 'reject'
    lines?: LineInput[]
    reject_reason?: string
  }
  if (!order_id || !['final_close', 'reject'].includes(decision ?? '')) {
    return NextResponse.json({ error: "order_id and decision ('final_close' | 'reject') are required" }, { status: 400 })
  }
  if (decision === 'reject' && !reject_reason) {
    return NextResponse.json({ error: 'reject_reason is required to reject (§12.1, audit trail)' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status').eq('order_id', order_id).single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['picker_completed_100', 'picker_completed_short'].includes(order.status)) {
    return NextResponse.json({ error: `Order status is '${order.status}' — must be Picker Completed to verify` }, { status: 409 })
  }

  let newStatus: string
  if (decision === 'final_close') {
    if (!Array.isArray(lines) || lines.length === 0) {
      return NextResponse.json({ error: 'lines[] itemizing every order line is required to Final Close' }, { status: 400 })
    }
    const { data: completion } = await admin.from('picker_completions').select('completion_id').eq('order_id', order_id).maybeSingle()
    if (!completion) return NextResponse.json({ error: 'No picker completion found for this order' }, { status: 409 })

    const { data: orderLines } = await admin.from('order_lines').select('line_id, qty').eq('order_id', order_id)
    const orderedQtyByLine = new Map((orderLines ?? []).map((l) => [l.line_id, Number(l.qty)]))
    if (orderedQtyByLine.size === 0) return NextResponse.json({ error: 'Order has no lines to verify' }, { status: 409 })

    const completionLines: { line_id: string; ordered_qty: number; picked_qty: number; is_short: boolean; short_reason_code: string | null; remark: string | null }[] = []
    for (const line of lines) {
      const orderedQty = orderedQtyByLine.get(line.line_id)
      if (orderedQty === undefined) return NextResponse.json({ error: `Line ${line.line_id} does not belong to this order` }, { status: 400 })
      const pickedQty = Number(line.picked_qty)
      if (!Number.isFinite(pickedQty) || pickedQty < 0 || pickedQty > orderedQty) {
        return NextResponse.json({ error: `Picked quantity for line ${line.line_id} must be between 0 and the ordered quantity (${orderedQty})` }, { status: 400 })
      }
      const isShort = pickedQty < orderedQty
      if (isShort && !line.short_reason_code) {
        return NextResponse.json({ error: `A short-pick reason is required for line ${line.line_id}` }, { status: 400 })
      }
      completionLines.push({ line_id: line.line_id, ordered_qty: orderedQty, picked_qty: pickedQty, is_short: isShort, short_reason_code: isShort ? line.short_reason_code! : null, remark: line.remark ?? null })
    }
    if (completionLines.length !== orderedQtyByLine.size) {
      return NextResponse.json({ error: 'All order lines must be itemized to Final Close' }, { status: 400 })
    }

    const actualPieces = completionLines.reduce((s, l) => s + l.picked_qty, 0)
    const result = completionLines.every((l) => !l.is_short) ? '100_percent' : 'short'

    await admin.from('picker_completion_lines').delete().eq('completion_id', completion.completion_id)
    const { error: linesError } = await admin.from('picker_completion_lines').insert(completionLines.map((l) => ({ completion_id: completion.completion_id, ...l })))
    if (linesError) return NextResponse.json({ error: linesError.message }, { status: 400 })

    await admin.from('picker_completions').update({ actual_pieces: actualPieces, result }).eq('completion_id', completion.completion_id)

    newStatus = result === '100_percent' ? 'final_closed_100' : 'final_closed_short'
  } else {
    newStatus = 'correction_in_progress'
  }

  const { error: verificationError } = await admin.from('admin_verifications').insert({
    order_id,
    admin_id: caller.user_id,
    decision,
    reject_reason: decision === 'reject' ? reject_reason : null,
  })
  if (verificationError) return NextResponse.json({ error: verificationError.message }, { status: 400 })

  await admin.from('orders').update({ status: newStatus }).eq('order_id', order_id)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: order_id, oldStatus: order.status, newStatus, changedBy: caller.user_id, reason: reject_reason })
  await writeAudit(admin, { userId: caller.user_id, action: `admin_verification.${decision}`, entityType: 'orders', entityId: order_id, after: { newStatus, reject_reason } })

  return NextResponse.json({ status: newStatus })
}
