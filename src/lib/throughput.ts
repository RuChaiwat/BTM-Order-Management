import { bangkokDateKey } from './formatDate'

/** Team output rate (pieces/hour) for the Operations Dashboard forecast.
 *  - source 'today': today's average = pieces finished today / hours since today's first finish.
 *    Used once today's work has run at least MIN_MINUTES (earlier than that one order can swing
 *    the rate wildly).
 *  - source 'prev': otherwise the most recent earlier working day's average = its pieces / hours
 *    from its first to its last finish (a day spanning under MIN_MINUTES is skipped).
 *  - source null: no usable history at all. */
export type Throughput = {
  rate: number | null
  source: 'today' | 'prev' | null
  /** 'prev' only: the Bangkok date key ("YYYY-MM-DD") the rate came from. */
  date: string | null
  /** Today's first finish (ISO), null when nothing finished today yet. */
  todayFirstAt: string | null
}

const MIN_MINUTES = 60

export function dailyThroughput(events: { at: string; pieces: number }[], nowMs: number): Throughput {
  const todayKey = bangkokDateKey(new Date(nowMs))
  const days = new Map<string, { first: number; last: number; pieces: number }>()
  for (const e of events) {
    const key = bangkokDateKey(e.at)
    if (!key) continue
    const t = new Date(e.at).getTime()
    const d = days.get(key)
    if (!d) days.set(key, { first: t, last: t, pieces: e.pieces })
    else {
      d.first = Math.min(d.first, t)
      d.last = Math.max(d.last, t)
      d.pieces += e.pieces
    }
  }
  const today = todayKey ? days.get(todayKey) : undefined
  const todayFirstAt = today ? new Date(today.first).toISOString() : null
  if (today && nowMs - today.first >= MIN_MINUTES * 60000) {
    return { rate: Math.round(today.pieces / ((nowMs - today.first) / 3600000)), source: 'today', date: null, todayFirstAt }
  }
  const earlier = [...days.keys()].filter((k) => todayKey && k < todayKey).sort().reverse()
  for (const key of earlier) {
    const d = days.get(key)!
    if (d.last - d.first < MIN_MINUTES * 60000) continue
    return { rate: Math.round(d.pieces / ((d.last - d.first) / 3600000)), source: 'prev', date: key, todayFirstAt }
  }
  return { rate: null, source: null, date: null, todayFirstAt }
}
