import type { SupabaseClient } from '@supabase/supabase-js'
import { unwrap } from './unwrap'
import { fetchAllRows } from './fetchAllRows'
import { fetchScopedByOrderIds } from './scopedFetch'
import { getActiveConfig } from './config'
import { bangkokDateKey, bangkokDayRange } from '../formatDate'
import { computeRoundBasedRate, computeAvgIdleMinutes, type RoundCompletion } from '../pickerProductivity'

/** Cycle time (Assigned → Picker Completed) at or under this is "on time" for the SLA KPI here.
 * Matches Control Tower's "overdue" threshold (§13); a dedicated configuration key is a
 * reasonable follow-up, not built here (same judgment call as order_alerts' thresholds). Exported
 * for getMonthlyProductivityHistory below, which re-derives the same day-level SLA % across a
 * whole month using this identical threshold. */
export const SLA_THRESHOLD_MINUTES = 120
const LEADERBOARD_SIZE = 10

/** §12.2/§13 Productivity & SLA analytics for a single (Bangkok-calendar) day, driven entirely by
 * the PICKER's own confirm date (picker_completions.picker_completed_time) -- deliberately
 * independent of Admin Verification, so a picker's work today shows up immediately without
 * waiting on Admin to get around to Final Close. A rolling multi-day average would hide exactly
 * the thing this page exists to show: how today's shift is doing right now.
 *
 * Only counts orders assigned directly from Work Assignment (order.consolidation_batch_id is
 * null) -- a Consolidation Batch's own cycle time is dominated by however long Sort takes to
 * finish before picking can even start, which has nothing to do with that picker's own
 * throughput and would make this page misrepresent it. (An order still linked to a batch means
 * that batch went through Consolidation's own Approve -- Matching's own candidate-stage link gets
 * cleared the moment an order is assigned directly instead, see consolidationCleanup.ts, so this
 * is never a false exclusion of an order that's actually a plain direct assignment.) */
export async function getProductivityData(db: SupabaseClient, warehouseCode: string, date: string) {
  const { sinceIso, untilIso } = bangkokDayRange(date)
  const [orders, pickers, employmentTypeRows, cfg, roundBatches] = await Promise.all([
    fetchAllRows((from, to) => db.from('orders').select('order_id, assigned_time, assignment_batch_id, consolidation_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).range(from, to)),
    db.from('pickers').select('picker_id, name_en, employment_type').eq('warehouse_code', warehouseCode).eq('active', true).then(unwrap),
    db.from('picker_employment_types').select('type_code, label_en').then(unwrap),
    // Same target used by the weekly Picker Productivity rating (migration 0020) -- configurable
    // rather than a second hardcoded number baked into this page.
    getActiveConfig(db, ['picker_productivity.target_pcs_per_hour']),
    // "Round" = how many times a picker was handed a fresh batch of work today (Admin confirmed
    // the assignment, i.e. assigned_time is set) -- independent of whether they've completed any
    // of it yet, unlike the completedRows-driven stats below.
    db.from('assignment_batches').select('picker_id').eq('warehouse_code', warehouseCode).not('picker_id', 'is', null).gte('assigned_time', sinceIso).lt('assigned_time', untilIso).then(unwrap),
  ])
  const targetPcsPerHour = Number(cfg.value('picker_productivity.target_pcs_per_hour') ?? 4500)
  const employmentTypeLabel = new Map(employmentTypeRows.map((t) => [t.type_code, t.label_en]))
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

  const productivityByPicker = new Map<string, { completed: number; short: number; onTime: number; piecesCompleted: number; piecesShort: number }>()
  const roundRows: RoundCompletion[] = []
  let totalPieces = 0
  let onTimeCount = 0
  let cycleTimedCount = 0
  let shortCount = 0

  for (const { order, completion } of completedRows) {
    const pickerId = order.assignment_batch_id ? pickerIdByBatch.get(order.assignment_batch_id) : null
    const isShort = completion.result === 'short'
    totalPieces += completion.actual_pieces ?? 0
    if (isShort) shortCount += 1

    const entry = pickerId ? productivityByPicker.get(pickerId) ?? { completed: 0, short: 0, onTime: 0, piecesCompleted: 0, piecesShort: 0 } : null
    if (entry) {
      entry.completed += 1
      if (isShort) entry.short += 1
      entry.piecesCompleted += completion.actual_pieces ?? 0
      entry.piecesShort += Math.max(0, (order.planned_pieces ?? 0) - (completion.actual_pieces ?? 0))
    }

    // SLA ("on time") stays a per-ORDER check -- whether THIS order was finished within the
    // promised window from when it was handed to the picker -- regardless of how many other
    // orders shared the same round. Only assigned-on-the-SAME-(Bangkok)-day orders count toward
    // it: one assigned yesterday but not confirmed until today (picker went home without
    // finishing it, or nobody got around to Unassigning it) would otherwise show a multi-day cycle
    // time that has nothing to do with today's actual work. It still counts toward Orders
    // Completed/Total Pieces/Short Pick Rate above, just not SLA/the Pcs/Hour rate below.
    const sameDayAssigned = !!order.assigned_time && bangkokDateKey(order.assigned_time) === date
    if (sameDayAssigned) {
      const rawMinutes = Math.max(1, (new Date(completion.picker_completed_time).getTime() - new Date(order.assigned_time as string).getTime()) / 60000)
      cycleTimedCount += 1
      const onTime = rawMinutes <= SLA_THRESHOLD_MINUTES
      if (onTime) onTimeCount += 1
      if (entry) {
        if (onTime) entry.onTime += 1
      }
      // Pcs/Hour, unlike SLA, groups by ROUND (assignment_batch_id) rather than per order -- see
      // computeRoundBasedRate's own comment for why summing each order's own elapsed time
      // double-counts overlapping work the more orders share one round.
      if (pickerId && order.assignment_batch_id) {
        roundRows.push({ pickerId, assignmentBatchId: order.assignment_batch_id, assignedTime: order.assigned_time as string, completedTime: completion.picker_completed_time, pieces: completion.actual_pieces ?? 0 })
      }
    }

    if (entry && pickerId) productivityByPicker.set(pickerId, entry)
  }

  const rateByPicker = computeRoundBasedRate(roundRows)
  const idleByPicker = computeAvgIdleMinutes(roundRows)
  let totalRatePieces = 0
  let totalRateMinutes = 0
  for (const r of rateByPicker.values()) {
    totalRatePieces += r.pieces
    totalRateMinutes += r.minutes
  }

  const pickerRows = pickers.map((p) => {
    const e = productivityByPicker.get(p.picker_id)
    const rate = rateByPicker.get(p.picker_id)
    const idleMinutes = idleByPicker.get(p.picker_id)
    return {
      user_id: p.picker_id,
      name: p.name_en,
      employmentType: p.employment_type ? employmentTypeLabel.get(p.employment_type) ?? p.employment_type : null,
      rounds: roundsByPicker.get(p.picker_id) ?? 0,
      pcsPerHour: rate && rate.minutes > 0 ? Math.round((rate.pieces / rate.minutes) * 60) : null,
      avgIdleMinutes: idleMinutes !== undefined ? Math.round(idleMinutes) : null,
      completed: e?.completed ?? 0,
      piecesCompleted: e?.piecesCompleted ?? 0,
      piecesShort: e?.piecesShort ?? 0,
      shortRate: e && e.completed > 0 ? Math.round((e.short / e.completed) * 1000) / 10 : null,
      slaPct: e && e.completed > 0 ? Math.round((e.onTime / e.completed) * 1000) / 10 : null,
    }
  }).filter((p) => p.rounds > 0) // a picker with no round assigned that day has nothing to show -- not "0 pcs/hr", just absent from the day's work entirely.

  // Leaderboards only make sense for pickers who actually worked this date -- a picker who didn't
  // work isn't "below target," they're simply absent from the day's productivity entirely.
  const workedPickers = pickerRows.filter((p) => p.completed > 0 && p.pcsPerHour !== null) as (typeof pickerRows[number] & { pcsPerHour: number })[]
  const topAboveTarget = [...workedPickers]
    .filter((p) => p.pcsPerHour > targetPcsPerHour)
    .sort((a, b) => b.pcsPerHour - a.pcsPerHour)
    .slice(0, LEADERBOARD_SIZE)
  const bottomPerformers = [...workedPickers].sort((a, b) => a.pcsPerHour - b.pcsPerHour).slice(0, LEADERBOARD_SIZE)

  return {
    date,
    targetPcsPerHour,
    pickerRows,
    topAboveTarget,
    bottomPerformers,
    kpis: {
      completedOrders: completedRows.length,
      totalPieces,
      avgPcsPerHour: totalRateMinutes > 0 ? Math.round((totalRatePieces / totalRateMinutes) * 60) : null,
      slaPct: cycleTimedCount > 0 ? Math.round((onTimeCount / cycleTimedCount) * 1000) / 10 : null,
      shortRatePct: completedRows.length > 0 ? Math.round((shortCount / completedRows.length) * 1000) / 10 : null,
    },
  }
}

export interface DailyProductivitySummary {
  date: string
  completedOrders: number
  totalPieces: number
  avgPcsPerHour: number | null
  slaPct: number | null
  shortPieces: number
  shortRatePct: number | null
}

/** Month-to-date, warehouse-wide (every picker combined) daily rollup for the "Daily Productivity"
 * history table below Picker Productivity -- always the CURRENT calendar month regardless of
 * whichever single `date` the page's own date picker has selected, and always EXCLUDING today
 * (today's own totals are already the KPI cards at the top of the page, so a reader never sees the
 * same number twice). Rolls over to empty automatically on the 1st of a new month, before any day
 * of it has data yet -- not a bug, just nothing to summarize.
 *
 * One broad fetch for the whole month (not one `getProductivityData` call per day -- that would
 * re-run this same set of queries up to ~30x on every page load) grouped by Bangkok-calendar day
 * in JS, same filtering rules as getProductivityData so the two can never disagree: Consolidation
 * Batch orders excluded, SLA/Pcs-Hour only from orders assigned the SAME day they were completed. */
export async function getMonthlyProductivityHistory(db: SupabaseClient, warehouseCode: string): Promise<DailyProductivitySummary[]> {
  const todayKey = bangkokDateKey(new Date())
  if (!todayKey) return []
  const monthStart = `${todayKey.slice(0, 7)}-01`
  if (monthStart === todayKey) return [] // today is the 1st of the month -- nothing earlier this month yet

  const { sinceIso: monthSinceIso } = bangkokDayRange(monthStart)
  const { sinceIso: todaySinceIso } = bangkokDayRange(todayKey) // exclusive upper bound -- start of today

  const orders = await fetchAllRows((from, to) =>
    db.from('orders').select('order_id, assigned_time, assignment_batch_id, consolidation_batch_id, planned_pieces').eq('warehouse_code', warehouseCode).range(from, to),
  )
  const orderById = new Map(orders.map((o) => [o.order_id, o]))
  const orderIds = orders.map((o) => o.order_id)

  const completions = await fetchScopedByOrderIds<{ order_id: string; actual_pieces: number | null; result: string; picker_completed_time: string }>(
    db,
    'get_picker_completions_by_ids',
    'order_id, actual_pieces, result, picker_completed_time',
    orderIds,
  )

  const monthRows = completions
    .filter((c) => c.picker_completed_time >= monthSinceIso && c.picker_completed_time < todaySinceIso)
    .map((completion) => ({ order: orderById.get(completion.order_id), completion }))
    .filter((r): r is { order: NonNullable<typeof r.order>; completion: typeof r.completion } => !!r.order && !r.order.consolidation_batch_id)

  const batchIds = [...new Set(monthRows.map((r) => r.order.assignment_batch_id).filter(Boolean))] as string[]
  const batchesRes = batchIds.length
    ? await db.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
    : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
  const pickerIdByBatch = new Map(unwrap(batchesRes).map((b) => [b.assignment_batch_id, b.picker_id]))

  const byDay = new Map<string, { completed: number; totalPieces: number; shortPieces: number; onTime: number; cycleTimed: number; roundRows: RoundCompletion[] }>()
  for (const { order, completion } of monthRows) {
    const day = bangkokDateKey(completion.picker_completed_time)
    if (!day) continue
    const entry = byDay.get(day) ?? { completed: 0, totalPieces: 0, shortPieces: 0, onTime: 0, cycleTimed: 0, roundRows: [] }
    entry.completed += 1
    entry.totalPieces += completion.actual_pieces ?? 0
    if (completion.result === 'short') entry.shortPieces += Math.max(0, (order.planned_pieces ?? 0) - (completion.actual_pieces ?? 0))

    const sameDayAssigned = !!order.assigned_time && bangkokDateKey(order.assigned_time) === day
    if (sameDayAssigned) {
      const rawMinutes = Math.max(1, (new Date(completion.picker_completed_time).getTime() - new Date(order.assigned_time as string).getTime()) / 60000)
      entry.cycleTimed += 1
      if (rawMinutes <= SLA_THRESHOLD_MINUTES) entry.onTime += 1
      const pickerId = order.assignment_batch_id ? pickerIdByBatch.get(order.assignment_batch_id) : null
      if (pickerId && order.assignment_batch_id) {
        entry.roundRows.push({ pickerId, assignmentBatchId: order.assignment_batch_id, assignedTime: order.assigned_time as string, completedTime: completion.picker_completed_time, pieces: completion.actual_pieces ?? 0 })
      }
    }
    byDay.set(day, entry)
  }

  return [...byDay.entries()]
    .map(([date, d]): DailyProductivitySummary => {
      const rate = computeRoundBasedRate(d.roundRows)
      let pieces = 0
      let minutes = 0
      for (const r of rate.values()) {
        pieces += r.pieces
        minutes += r.minutes
      }
      return {
        date,
        completedOrders: d.completed,
        totalPieces: d.totalPieces,
        avgPcsPerHour: minutes > 0 ? Math.round((pieces / minutes) * 60) : null,
        slaPct: d.cycleTimed > 0 ? Math.round((d.onTime / d.cycleTimed) * 1000) / 10 : null,
        shortPieces: d.shortPieces,
        shortRatePct: d.totalPieces > 0 ? Math.round((d.shortPieces / d.totalPieces) * 1000) / 10 : null,
      }
    })
    .sort((a, b) => b.date.localeCompare(a.date))
}
