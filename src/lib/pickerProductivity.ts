export type ProductivityLevel = 'above_target' | 'target' | 'yellow' | 'red'

/** Floor for a ROUND's elapsed minutes used in a Pieces/Hour rate -- a round confirmed within
 * seconds of being assigned (rush, test data) would otherwise divide pieces by an unrealistically
 * tiny number and produce a rate in the thousands/hour that isn't a meaningful throughput figure.
 * Only the RATE math is floored -- the real elapsed time still drives the SLA/on-time check, and
 * the picker's own confirm action is never blocked or delayed by this. */
export const MIN_CYCLE_MINUTES_FOR_RATE = 5

export interface RoundCompletion {
  pickerId: string
  assignmentBatchId: string
  assignedTime: string
  completedTime: string
  pieces: number
}

interface RoundSummary {
  pickerId: string
  pieces: number
  assignedAt: number
  lastCompletedAt: number
}

/** Shared by computeRoundBasedRate and computeAvgIdleMinutes below -- groups raw completions by
 * the ROUND (assignment_batch_id) they belong to, merging every order confirmed in that round
 * into one summary: total pieces, when the round was handed out, and the LAST confirm time in it. */
function groupIntoRounds(rows: RoundCompletion[]): Map<string, RoundSummary> {
  const roundTotals = new Map<string, RoundSummary>()
  for (const r of rows) {
    const assignedAt = new Date(r.assignedTime).getTime()
    const completedAt = new Date(r.completedTime).getTime()
    const existing = roundTotals.get(r.assignmentBatchId)
    if (existing) {
      existing.pieces += r.pieces
      existing.lastCompletedAt = Math.max(existing.lastCompletedAt, completedAt)
    } else {
      roundTotals.set(r.assignmentBatchId, { pickerId: r.pickerId, pieces: r.pieces, assignedAt, lastCompletedAt: completedAt })
    }
  }
  return roundTotals
}

/** Pieces/Hour throughput, grouped by the ROUND (assignment_batch_id) a completion belongs to --
 * not summed per order. A round hands a picker several orders at once (one shared assigned_time)
 * that they then confirm one at a time at staggered moments; summing each order's own
 * (confirmed - assigned) duration separately double/triple-counts the time already spent on
 * earlier orders in the same round, the more orders land in one round -- inflates the minutes
 * denominator and understates the picker's real throughput. Grouping by round instead measures
 * (the round's LAST confirm time - its assigned_time) once per round, matching how the picker
 * actually experienced it: one continuous stretch of work, not N independent clocks all started at
 * the same instant.
 *
 * Used identically by Operations Dashboard's "Today's Picker Productivity" (queries/dashboard.ts),
 * the Productivity & SLA page (queries/productivity.ts), and the weekly productivity export's
 * Picker Daily Summary sheet (api/cron/weekly-export) -- kept here, not duplicated in any of them,
 * after two of them already drifted out of sync once. Callers are responsible for filtering `rows`
 * down to whatever scope they mean by "today"/"this week" and excluding Consolidation-linked
 * orders first; this function only does the round-grouping + rate math. */
export function computeRoundBasedRate(rows: RoundCompletion[]): Map<string, { pieces: number; minutes: number }> {
  const rateByPicker = new Map<string, { pieces: number; minutes: number }>()
  for (const round of groupIntoRounds(rows).values()) {
    const rawMinutes = Math.max(1, (round.lastCompletedAt - round.assignedAt) / 60000)
    const rateMinutes = Math.max(MIN_CYCLE_MINUTES_FOR_RATE, rawMinutes)
    const entry = rateByPicker.get(round.pickerId) ?? { pieces: 0, minutes: 0 }
    entry.pieces += round.pieces
    entry.minutes += rateMinutes
    rateByPicker.set(round.pickerId, entry)
  }
  return rateByPicker
}

/** Average gap, in minutes, between the END of one of a picker's rounds (its last confirm) and
 * the START of their NEXT round (its assigned_time) that day -- time the picker had no round in
 * hand at all, waiting to be given more work. Rounds are assumed never to overlap (the system
 * blocks assigning a picker a new round before their current one is fully confirmed), so sorting
 * by assigned_time gives a clean, non-overlapping timeline to measure gaps from.
 *
 * A picker with only one round that day has no gap to measure at all -- left out of the returned
 * map entirely rather than given a 0, so the UI can render "--" and never misreport "no idle time"
 * when the real answer is "not enough rounds today to tell". Same input shape as
 * computeRoundBasedRate (already filtered/scoped by the caller); this is a separate function
 * because idle time and throughput rate are different questions about the same rounds. */
export function computeAvgIdleMinutes(rows: RoundCompletion[]): Map<string, number> {
  const roundsByPicker = new Map<string, RoundSummary[]>()
  for (const round of groupIntoRounds(rows).values()) {
    if (!roundsByPicker.has(round.pickerId)) roundsByPicker.set(round.pickerId, [])
    roundsByPicker.get(round.pickerId)!.push(round)
  }

  const idleByPicker = new Map<string, number>()
  for (const [pickerId, rounds] of roundsByPicker) {
    if (rounds.length < 2) continue
    rounds.sort((a, b) => a.assignedAt - b.assignedAt)
    const gaps: number[] = []
    for (let i = 1; i < rounds.length; i++) {
      const gapMinutes = (rounds[i].assignedAt - rounds[i - 1].lastCompletedAt) / 60000
      if (gapMinutes > 0) gaps.push(gapMinutes)
    }
    if (gaps.length > 0) idleByPicker.set(pickerId, gaps.reduce((s, g) => s + g, 0) / gaps.length)
  }
  return idleByPicker
}

/** Weekly auto-computed Picker Productivity rating (migration 0020) -- red/yellow/green/dark-green
 * banding of a picker's all-time average pcs/hour against a configurable target, recomputed every
 * Sunday by /api/cron/picker-productivity. Never set by hand. `null` means no completions yet
 * (new picker), shown as gray rather than any of the four bands. */
export const PRODUCTIVITY_LEVEL_META: Record<ProductivityLevel, { label: string; color: string; bg: string }> = {
  above_target: { label: 'Above Target', color: '#166534', bg: '#DCFCE7' },
  target: { label: 'Target', color: '#16A34A', bg: '#F0FDF4' },
  yellow: { label: 'Below Target', color: '#B45309', bg: '#FFFBEB' },
  red: { label: 'Low', color: '#DC2626', bg: '#FEF2F2' },
}

export const PRODUCTIVITY_NO_DATA_META = { label: 'No data yet', color: '#6B7280', bg: '#F3F4F6' }

export function productivityMeta(level: string | null) {
  return level && level in PRODUCTIVITY_LEVEL_META ? PRODUCTIVITY_LEVEL_META[level as ProductivityLevel] : PRODUCTIVITY_NO_DATA_META
}

/** Same 4-level thresholds as recompute_picker_productivity() (migration 0020), for the one place
 * that still bands in JS rather than SQL: Operations Dashboard's "Today's Picker Productivity",
 * which only ever has completed-today pickers in it -- no "no data yet" case applies there, so it
 * always resolves to one of the four bands, never null. */
export function bandForPct(pct: number): ProductivityLevel {
  if (pct > 100) return 'above_target'
  if (pct >= 80) return 'target'
  if (pct >= 60) return 'yellow'
  return 'red'
}
