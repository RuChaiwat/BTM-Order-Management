import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds } from './scopedFetch'
import { getActiveConfig } from './config'
import { bangkokDateKey, bangkokDayRange } from '../formatDate'

/** Cycle time (Assigned → Picker Completed) at or under this is "on time" for the SLA KPI here.
 * Matches Control Tower's "overdue" threshold (§13); a dedicated configuration key is a
 * reasonable follow-up, not built here (same judgment call as order_alerts' thresholds). */
const SLA_THRESHOLD_MINUTES = 120
const LEADERBOARD_SIZE = 10

/** Floor for the cycle-time minutes an order contributes to a Pcs/Hour calculation -- a real pick
 * confirmed in under this looks the same as one confirmed within seconds of being assigned (test
 * data, or a picker confirming in a rush), and either way divides pieces by an unrealistically tiny
 * number of minutes and produces a rate in the thousands/hour that isn't a meaningful throughput
 * figure. Only the RATE math is floored -- the real elapsed time still drives the SLA/on-time
 * check above, and the picker's own confirm action is never blocked or delayed by this. */
export const MIN_CYCLE_MINUTES_FOR_RATE = 5

/** §12.2/§13 Productivity / SLA / Short Pick analytics for a single (Bangkok-calendar) day, driven
 * entirely by the PICKER's own confirm date (picker_completions.picker_completed_time) --
 * deliberately independent of Admin Verification, so a picker's work today shows up immediately
 * without waiting on Admin to get around to Final Close. A rolling multi-day average would hide
 * exactly the thing this page exists to show: how today's shift is doing right now.
 *
 * Only counts orders assigned directly from Work Assignment (order.consolidation_batch_id is
 * null) -- a Consolidation Batch's own cycle time is dominated by however long Sort takes to
 * finish before picking can even start, which has nothing to do with that picker's own
 * throughput and would make this page misrepresent it. (An order still linked to a batch means
 * that batch went through Consolidation's own Approve -- Matching's own candidate-stage link gets
 * cleared the moment an order is assigned directly instead, see consolidationCleanup.ts, so this
 * is never a false exclusion of an order that's actually a plain direct assignment.)
 *
 * One consequence of that independence: reason-level Short Pick detail (picker_completion_lines)
 * is only ever written at Admin Verification's Final Close step (app/api/admin-verifications/
 * route.ts) -- the picker's own submission is coarse, by design (§12.2 redesign). So the Short
 * Pick Reasons table can only show reasons for orders on this date that HAVE been verified so
 * far; an order the picker just completed but Admin hasn't touched yet still counts toward Orders
 * Completed/Total Pieces/SLA/Short Pick Rate (all picker-reported), just not yet toward the
 * reason breakdown. */
export async function getProductivityData(db: SupabaseClient, warehouseCode: string, date: string) {
  const { sinceIso, untilIso } = bangkokDayRange(date)
  const [orders, pickers, cfg, roundBatches] = await Promise.all([
    fetchAllRows((from, to) => db.from('orders').select('order_id, assigned_time, assignment_batch_id, consolidation_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).range(from, to)),
    db.from('pickers').select('picker_id, name_en').eq('warehouse_code', warehouseCode).eq('active', true).then(unwrap),
    // Same target used by the weekly Picker Productivity rating (migration 0020) -- configurable
    // rather than a second hardcoded number baked into this page.
    getActiveConfig(db, ['picker_productivity.target_pcs_per_hour']),
    // "Round" = how many times a picker was handed a fresh batch of work today (Admin confirmed
    // the assignment, i.e. assigned_time is set) -- independent of whether they've completed any
    // of it yet, unlike the completedRows-driven stats below.
    db.from('assignment_batches').select('picker_id').eq('warehouse_code', warehouseCode).not('picker_id', 'is', null).gte('assigned_time', sinceIso).lt('assigned_time', untilIso).then(unwrap),
  ])
  const targetPcsPerHour = Number(cfg.value('picker_productivity.target_pcs_per_hour') ?? 4500)
  const roundsByPicker = new Map<string, number>()
  for (const b of roundBatches) {
    roundsByPicker.set(b.picker_id as string, (roundsByPicker.get(b.picker_id as string) ?? 0) + 1)
  }
  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const orderIds = orders.map((o) => o.order_id)

  // picker_completions has no warehouse_code column, so it's fetched via an RPC scoped to exactly
  // this warehouse's order_ids (same pattern as dashboard.ts/backlog.ts) instead of a plain
  // .gte() filter across every warehouse with no .range() paging -- past Supabase's default row
  // cap that used to risk silently dropping this warehouse's own rows behind another warehouse's.
  const completions = await fetchScopedByOrderIds<{ completion_id: string; order_id: string; actual_pieces: number | null; result: string; picker_completed_time: string }>(
    db,
    'get_picker_completions_by_ids',
    'completion_id, order_id, actual_pieces, result, picker_completed_time',
    orderIds,
  )

  const completedRows = completions
    .filter((c) => bangkokDateKey(c.picker_completed_time) === date)
    .map((completion) => ({ order: orderById.get(completion.order_id), completion }))
    .filter((r): r is { order: NonNullable<typeof r.order>; completion: typeof r.completion } => !!r.order && !r.order.consolidation_batch_id)

  const batchIds = [...new Set(completedRows.map((r) => r.order.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))

  const productivityByPicker = new Map<string, { pieces: number; minutes: number; completed: number; short: number; onTime: number; piecesCompleted: number; piecesShort: number }>()
  let totalPieces = 0
  let totalMinutes = 0
  let onTimeCount = 0
  let cycleTimedCount = 0
  let shortCount = 0

  for (const { order, completion } of completedRows) {
    const pickerId = order.assignment_batch_id ? pickerIdByBatch.get(order.assignment_batch_id) : null
    const isShort = completion.result === 'short'
    totalPieces += completion.actual_pieces ?? 0
    if (isShort) shortCount += 1

    const entry = pickerId ? productivityByPicker.get(pickerId) ?? { pieces: 0, minutes: 0, completed: 0, short: 0, onTime: 0, piecesCompleted: 0, piecesShort: 0 } : null
    if (entry) {
      entry.completed += 1
      if (isShort) entry.short += 1
      entry.piecesCompleted += completion.actual_pieces ?? 0
      entry.piecesShort += Math.max(0, (order.planned_pieces ?? 0) - (completion.actual_pieces ?? 0))
    }

    // Rate/SLA math only counts an order assigned on this SAME (Bangkok) day -- one assigned
    // yesterday but not confirmed until today (picker went home without finishing it, or nobody
    // got around to Unassigning it) would otherwise show a multi-day cycle time that has nothing
    // to do with today's actual work and would drag today's Pcs/Hour down for no real reason. It
    // still counts toward Orders Completed/Total Pieces/Short Pick Rate above, just not the rate.
    const sameDayAssigned = !!order.assigned_time && bangkokDateKey(order.assigned_time) === date
    if (sameDayAssigned) {
      const rawMinutes = Math.max(1, (new Date(completion.picker_completed_time).getTime() - new Date(order.assigned_time as string).getTime()) / 60000)
      const rateMinutes = Math.max(MIN_CYCLE_MINUTES_FOR_RATE, rawMinutes)
      totalMinutes += rateMinutes
      cycleTimedCount += 1
      const onTime = rawMinutes <= SLA_THRESHOLD_MINUTES
      if (onTime) onTimeCount += 1
      if (entry) {
        entry.pieces += completion.actual_pieces ?? 0
        entry.minutes += rateMinutes
        if (onTime) entry.onTime += 1
      }
    }

    if (entry && pickerId) productivityByPicker.set(pickerId, entry)
  }

  const pickerRows = pickers.map((p) => {
    const e = productivityByPicker.get(p.picker_id)
    return {
      user_id: p.picker_id,
      name: p.name_en,
      rounds: roundsByPicker.get(p.picker_id) ?? 0,
      pcsPerHour: e && e.minutes > 0 ? Math.round((e.pieces / e.minutes) * 60) : null,
      completed: e?.completed ?? 0,
      piecesCompleted: e?.piecesCompleted ?? 0,
      piecesShort: e?.piecesShort ?? 0,
      shortRate: e && e.completed > 0 ? Math.round((e.short / e.completed) * 1000) / 10 : null,
      slaPct: e && e.completed > 0 ? Math.round((e.onTime / e.completed) * 1000) / 10 : null,
    }
  })

  // Leaderboards only make sense for pickers who actually worked this date -- a picker who didn't
  // work isn't "below target," they're simply absent from the day's productivity entirely.
  const workedPickers = pickerRows.filter((p) => p.completed > 0 && p.pcsPerHour !== null) as (typeof pickerRows[number] & { pcsPerHour: number })[]
  const topAboveTarget = [...workedPickers]
    .filter((p) => p.pcsPerHour > targetPcsPerHour)
    .sort((a, b) => b.pcsPerHour - a.pcsPerHour)
    .slice(0, LEADERBOARD_SIZE)
  const bottomPerformers = [...workedPickers].sort((a, b) => a.pcsPerHour - b.pcsPerHour).slice(0, LEADERBOARD_SIZE)

  // Reason-level detail only exists once Admin has Final Closed the order (see the function-level
  // note above) -- this naturally shows fewer rows than completedRows until Admin catches up, but
  // never blocks the KPIs above, which are picker-reported and available immediately.
  const completionIds = completedRows.map((r) => r.completion.completion_id)
  const shortLinesRes = completionIds.length
    ? await db.from('picker_completion_lines').select('line_id, short_reason_code, ordered_qty, picked_qty').in('completion_id', completionIds).eq('is_short', true)
    : { data: [] as { line_id: string; short_reason_code: string | null; ordered_qty: number; picked_qty: number }[] }
  const shortLines = unwrap(shortLinesRes)

  const lineIds = shortLines.map((l) => l.line_id)
  const orderLinesRes = lineIds.length ? await db.from('order_lines').select('line_id, zone_code').in('line_id', lineIds) : { data: [] as { line_id: string; zone_code: string | null }[] }
  const zoneByLine = new Map(unwrap(orderLinesRes).map((l) => [l.line_id, l.zone_code]))

  const reasonsRes = await db.from('reason_master').select('reason_code, label_en').eq('reason_type', 'short_pick')
  const labelByReason = new Map(unwrap(reasonsRes).map((r) => [r.reason_code, r.label_en]))

  const reasonTotals = new Map<string, { code: string; zone: string; count: number; shortPieces: number }>()
  for (const l of shortLines) {
    const code = l.short_reason_code ?? 'UNKNOWN'
    const zone = zoneByLine.get(l.line_id) ?? '—'
    const key = `${code}__${zone}`
    const entry = reasonTotals.get(key) ?? { code, zone, count: 0, shortPieces: 0 }
    entry.count += 1
    entry.shortPieces += Number(l.ordered_qty) - Number(l.picked_qty)
    reasonTotals.set(key, entry)
  }
  const reasonBreakdown = [...reasonTotals.values()]
    .map((t) => ({ code: t.code, label: labelByReason.get(t.code) ?? t.code, zone: t.zone, count: t.count, shortPieces: t.shortPieces }))
    .sort((a, b) => b.shortPieces - a.shortPieces)

  return {
    date,
    targetPcsPerHour,
    pickerRows,
    reasonBreakdown,
    topAboveTarget,
    bottomPerformers,
    kpis: {
      completedOrders: completedRows.length,
      totalPieces,
      avgPcsPerHour: totalMinutes > 0 ? Math.round((totalPieces / totalMinutes) * 60) : null,
      slaPct: cycleTimedCount > 0 ? Math.round((onTimeCount / cycleTimedCount) * 1000) / 10 : null,
      shortRatePct: completedRows.length > 0 ? Math.round((shortCount / completedRows.length) * 1000) / 10 : null,
    },
  }
}
