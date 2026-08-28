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
 * §12.2 Pick Completion: picker scans the order, sees every order line, marks the ones that were
 * short-picked with a reason + actual quantity, and confirms. `lines` must itemize every line on
 * the order — lines with picked_qty === ordered qty are treated as fully picked, the rest as
 * short. actual_pieces/result are derived server-side from the lines, not trusted from the client.
 * Confirming stops the order's clock (picker_completed_time) and moves it into the Admin
 * Verification queue (picker_completed_100/short — see "Waiting Admin Verification" design note
 * in the route this replaces at admin-verifications/route.ts).
 */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin', 'zone_controller', 'picker'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { order_id, lines, remark } = (await request.json()) as { order_id?: string; lines?: LineInput[]; remark?: string }
  if (!order_id || !Array.isArray(lines) || lines.length === 0) {
    return NextResponse.json({ error: 'order_id and a non-empty lines[] are required' }, { status: 400 })
  }

  const admin = createAdminClient()
  const { data: order } = await admin.from('orders').select('order_id, status, planned_pieces, assignment_batch_id').eq('order_id', order_id).single()
  if (!order) return NextResponse.json({ error: 'Order not found' }, { status: 404 })
  if (!['assigned', 'in_progress', 'correction_in_progress'].includes(order.status)) {
    return NextResponse.json({ error: `Order status is '${order.status}' — must be Assigned, In Progress, or returned for correction to complete` }, { status: 409 })
  }

  if (caller.role === 'picker') {
    const { data: batch } = await admin.from('assignment_batches').select('picker_id').eq('assignment_batch_id', order.assignment_batch_id ?? '').maybeSingle()
    if (!batch || batch.picker_id !== caller.user_id) {
      return NextResponse.json({ error: 'This order is not assigned to you' }, { status: 403 })
    }
  }

  const { data: orderLines } = await admin.from('order_lines').select('line_id, qty').eq('order_id', order_id)
  const orderedQtyByLine = new Map((orderLines ?? []).map((l) => [l.line_id, Number(l.qty)]))
  if (orderedQtyByLine.size === 0) return NextResponse.json({ error: 'Order has no lines to complete' }, { status: 409 })

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
      return NextResponse.json({ error: `A short-pick reason is required for line ${line.line_id} (§12.2)` }, { status: 400 })
    }
    completionLines.push({ line_id: line.line_id, ordered_qty: orderedQty, picked_qty: pickedQty, is_short: isShort, short_reason_code: isShort ? line.short_reason_code! : null, remark: line.remark ?? null })
  }
  if (completionLines.length !== orderedQtyByLine.size) {
    return NextResponse.json({ error: 'All order lines must be itemized to complete the order' }, { status: 400 })
  }

  const actualPieces = completionLines.reduce((s, l) => s + l.picked_qty, 0)
  const result = actualPieces >= order.planned_pieces ? '100_percent' : 'short'
  const firstShortReason = completionLines.find((l) => l.is_short)?.short_reason_code ?? null

  // picker_completions.order_id is unique — a resubmission after Admin rejects for correction
  // (order_status 'correction_in_progress') upserts the same row and its line detail is replaced,
  // rather than accumulating a second completion for the same order.
  const nowIso = new Date().toISOString()
  const { data: completion, error: completionError } = await admin
    .from('picker_completions')
    .upsert({ order_id, picker_completed_time: nowIso, actual_pieces: actualPieces, result, short_reason_code: firstShortReason, remark: remark ?? null }, { onConflict: 'order_id' })
    .select('completion_id')
    .single()
  if (completionError || !completion) return NextResponse.json({ error: completionError?.message ?? 'Failed to record completion' }, { status: 400 })

  await admin.from('picker_completion_lines').delete().eq('completion_id', completion.completion_id)
  const { error: linesError } = await admin.from('picker_completion_lines').insert(completionLines.map((l) => ({ completion_id: completion.completion_id, ...l })))
  if (linesError) {
    return NextResponse.json({ error: linesError.message }, { status: 400 })
  }

  const newStatus = result === '100_percent' ? 'picker_completed_100' : 'picker_completed_short'
  await admin.from('orders').update({ status: newStatus, picker_completed_time: nowIso }).eq('order_id', order_id)
  await writeStatusHistory(admin, { entityType: 'orders', entityId: order_id, oldStatus: order.status, newStatus, changedBy: caller.user_id })
  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'picker_completion.create',
    entityType: 'orders',
    entityId: order_id,
    after: { result, actual_pieces: actualPieces, short_lines: completionLines.filter((l) => l.is_short).length },
  })

  return NextResponse.json({ status: newStatus }, { status: 201 })
}
