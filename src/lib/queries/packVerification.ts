import type { SupabaseClient } from '@supabase/supabase-js'

export interface PackVerifyQueueItem {
  order_id: string
  order_no: string
  store_code: string
  pieces: number
  packerId: string | null
  packerName: string
  stationCode: string | null
  packedAt: string | null
  packSeconds: number | null
  /** true when the last pack attempt was Completed with Short (closed by a supervisor afterwards) */
  hadIssue: boolean
  waitMinutes: number
}

/** Admin Pack Verify queue: every order the packers finished (pack_status = 'packed') in this
 * warehouse, oldest-packed first, with who/where/how long from its latest pack session. */
export async function getPackVerifyQueue(db: SupabaseClient, warehouseCode: string): Promise<PackVerifyQueueItem[]> {
  const { data: orders, error } = await db.from('orders').select('order_id, order_no, store_code, planned_pieces').eq('warehouse_code', warehouseCode).eq('pack_status', 'packed').limit(2000)
  if (error) throw new Error(error.message)
  const list = orders ?? []
  if (list.length === 0) return []

  // Chunked so a long queue never builds an over-long ?order_id=in.(...) URL.
  const sessions: { order_id: string; picker_id: string; station_code: string; started_at: string; finished_at: string | null; result: string | null; pieces: number }[] = []
  for (let i = 0; i < list.length; i += 150) {
    const ids = list.slice(i, i + 150).map((o) => o.order_id)
    const { data } = await db.from('pack_sessions').select('order_id, picker_id, station_code, started_at, finished_at, result, pieces').in('order_id', ids).not('finished_at', 'is', null).neq('result', 'cancelled')
    sessions.push(...(data ?? []))
  }
  const latestByOrder = new Map<string, (typeof sessions)[number]>()
  for (const s of sessions) {
    const cur = latestByOrder.get(s.order_id)
    if (!cur || (s.finished_at ?? '') > (cur.finished_at ?? '')) latestByOrder.set(s.order_id, s)
  }

  const pickerIds = [...new Set(sessions.map((s) => s.picker_id))]
  const { data: pickers } = pickerIds.length ? await db.from('pickers').select('picker_id, name_en, name_th').in('picker_id', pickerIds) : { data: [] as { picker_id: string; name_en: string; name_th: string | null }[] }
  const nameById = new Map((pickers ?? []).map((p) => [p.picker_id, p.name_th || p.name_en]))

  return list
    .map((o) => {
      const s = latestByOrder.get(o.order_id)
      const packedAt = s?.finished_at ?? null
      return {
        order_id: o.order_id,
        order_no: o.order_no,
        store_code: o.store_code,
        pieces: s?.pieces ?? o.planned_pieces,
        packerId: s?.picker_id ?? null,
        packerName: s ? nameById.get(s.picker_id) ?? s.picker_id : '—',
        stationCode: s?.station_code ?? null,
        packedAt,
        packSeconds: s?.finished_at ? Math.round((new Date(s.finished_at).getTime() - new Date(s.started_at).getTime()) / 1000) : null,
        hadIssue: s?.result === 'completed_short',
        waitMinutes: packedAt ? Math.max(0, Math.round((Date.now() - new Date(packedAt).getTime()) / 60000)) : 0,
      }
    })
    .sort((a, b) => (a.packedAt ?? '').localeCompare(b.packedAt ?? ''))
}
