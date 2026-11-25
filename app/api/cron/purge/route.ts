import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'
import { fetchAllRows } from '@/lib/queries/fetchAllRows'

// A first run after a long gap can have tens of thousands of orders to remove.
export const maxDuration = 300

const CHUNK = 100
/** Stop starting new chunks after this long; whatever is left goes on the next (daily) run. */
const TIME_BUDGET_MS = 240_000

/**
 * §20.2 retention purge -- runs daily (vercel.json). Keeps `retention.transaction_days` (default
 * 60) of history and permanently deletes what is older, but ONLY when a successful weekly export
 * already covers the cutoff date (otherwise nothing is deleted).
 *
 * What is deleted, older than the cutoff (by original_order_date):
 *   - orders that left the workflow: cancelled, or admin Final Closed whose pack work is done
 *     (pack_status confirmed, or none for orders closed before the packing module), together with
 *     everything recorded against them: picker completions (+ short lines), admin verifications,
 *     consolidation / assignment links, status history, order lines and all pack data (pack
 *     sessions, issues, issue lines, verifications -- these cascade from the order).
 *   - assignment / consolidation batches no order points to any more.
 *   - import history (import_batches + their import_errors) no order points to any more.
 *   - audit_logs rows older than the cutoff.
 * Work is done in chunks of 100 ids so no request grows past PostgREST's URL limit, and each
 * table's count is written to purge_log (Admin > Housekeeping shows it).
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  // Public path (middleware): only a real, non-empty CRON_SECRET counts -- never "Bearer undefined".
  const isCron = !!process.env.CRON_SECRET && authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) {
    const user = await getSessionUser()
    if (!user || user.role !== 'system_admin') {
      return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
    }
  }

  const startedMs = Date.now()
  const outOfTime = () => Date.now() - startedMs > TIME_BUDGET_MS
  const admin = createAdminClient()

  const { data: retentionConfig } = await admin.from('configuration').select('value').eq('key', 'retention.transaction_days').eq('scope', 'global').eq('active', true).maybeSingle()
  const retentionDays = Math.max(1, Number(retentionConfig?.value ?? 60) || 60)
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const cutoffDateStr = cutoff.toISOString().slice(0, 10)

  // --- safety gate: a successful weekly export must already cover up to the cutoff ---
  const { data: coveringExport } = await admin
    .from('export_jobs')
    .select('id, period_end')
    .eq('job_type', 'weekly_productivity_export')
    .eq('status', 'success')
    .gte('period_end', cutoffDateStr)
    .order('period_end', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (!coveringExport) {
    await admin.from('purge_log').insert({
      covered_period_start: cutoffDateStr,
      covered_period_end: cutoffDateStr,
      table_name: 'orders',
      rows_purged: 0,
      result: 'failed',
      executed_by: 'system',
    })
    return NextResponse.json({ status: 'blocked', reason: `ยังไม่มี Export รายสัปดาห์ที่สำเร็จครอบคลุมวันตัดข้อมูล (${cutoffDateStr}) จึงยังลบข้อมูลไม่ได้` }, { status: 409 })
  }

  const counts: Record<string, number> = {}
  const add = (table: string, n: number | null | undefined) => {
    counts[table] = (counts[table] ?? 0) + (n ?? 0)
  }
  let failure: string | null = null
  let finished = true

  // --- 1. old orders that have left the workflow (pick AND pack done, or cancelled) ---
  const orderIds = (
    await fetchAllRows<{ order_id: string }>((from, to) =>
      admin
        .from('orders')
        .select('order_id')
        .lt('original_order_date', cutoffDateStr)
        .or('status.eq.cancelled,and(status.in.(final_closed_100,final_closed_short),or(pack_status.is.null,pack_status.eq.confirmed))')
        .order('order_id')
        .range(from, to),
    )
  ).map((o) => o.order_id)

  for (let i = 0; i < orderIds.length && !failure; i += CHUNK) {
    if (outOfTime()) {
      finished = false
      break
    }
    const ids = orderIds.slice(i, i + CHUNK)
    // Children without ON DELETE CASCADE first; order_lines and every pack table cascade from orders.
    const steps: [string, () => PromiseLike<{ count: number | null; error: { message: string } | null }>][] = [
      ['picker_completions', () => admin.from('picker_completions').delete({ count: 'exact' }).in('order_id', ids)],
      ['admin_verifications', () => admin.from('admin_verifications').delete({ count: 'exact' }).in('order_id', ids)],
      ['consolidation_orders', () => admin.from('consolidation_orders').delete({ count: 'exact' }).in('order_id', ids)],
      ['assignment_orders', () => admin.from('assignment_orders').delete({ count: 'exact' }).in('order_id', ids)],
      ['status_history', () => admin.from('status_history').delete({ count: 'exact' }).eq('entity_type', 'orders').in('entity_id', ids)],
      ['orders', () => admin.from('orders').delete({ count: 'exact' }).in('order_id', ids)],
    ]
    for (const [table, run] of steps) {
      const { count, error } = await run()
      if (error) {
        failure = `${table}: ${error.message}`
        break
      }
      add(table, count)
    }
  }

  // --- 2. batches and import history nothing points to any more ---
  if (!failure && finished) {
    const before = cutoff.toISOString()
    // Assignment batches first: they may point at a consolidation batch.
    const r1 = await deleteUnreferenced(admin, 'assignment_batches', 'assignment_batch_id', 'created_at', before, [
      { table: 'orders', column: 'assignment_batch_id' },
      { table: 'assignment_orders', column: 'assignment_batch_id' },
    ], outOfTime)
    const r2 = await deleteUnreferenced(admin, 'consolidation_batches', 'consol_batch_id', 'created_at', before, [
      { table: 'orders', column: 'consolidation_batch_id' },
      { table: 'consolidation_orders', column: 'consol_batch_id' },
      { table: 'assignment_batches', column: 'linked_consolidation_batch_id' },
    ], outOfTime)
    const r3 = await deleteUnreferenced(admin, 'import_batches', 'import_id', 'uploaded_at', before, [{ table: 'orders', column: 'import_id' }], outOfTime)
    add('assignment_batches', r1.deleted)
    add('consolidation_batches', r2.deleted)
    add('import_batches', r3.deleted)
    failure = r1.error ?? r2.error ?? r3.error
    if (!r1.finished || !r2.finished || !r3.finished) finished = false
  }

  // --- 3. audit log older than the cutoff (not owned by any single order) ---
  if (!failure && finished) {
    const { count, error } = await admin.from('audit_logs').delete({ count: 'exact' }).lt('created_at', cutoff.toISOString())
    if (error) failure = `audit_logs: ${error.message}`
    else add('audit_logs', count)
  }

  // One purge_log row per table that changed (or a single row when nothing was old enough).
  const logged = Object.entries(counts).filter(([, n]) => n > 0)
  const logRow = (table: string, rows: number, result: 'success' | 'failed') => ({
    export_job_id: coveringExport.id,
    covered_period_start: cutoffDateStr,
    covered_period_end: cutoffDateStr,
    table_name: table,
    rows_purged: rows,
    result,
    executed_by: 'system',
  })
  const logRows = (logged.length ? logged : [['orders', 0] as [string, number]]).map(([table, rows]) => logRow(table, rows, 'success'))
  if (failure) {
    console.error('[purge] failed', failure)
    logRows.push(logRow(failure.split(':')[0], 0, 'failed'))
  }
  await admin.from('purge_log').insert(logRows)

  if (failure) return NextResponse.json({ status: 'failed', cutoff: cutoffDateStr, purged: counts, error: 'ลบข้อมูลไม่สำเร็จบางส่วน กรุณาแจ้งผู้ดูแลระบบ' }, { status: 500 })
  return NextResponse.json({ status: finished ? 'success' : 'partial', cutoff: cutoffDateStr, retentionDays, purged: counts })
}

type Ref = { table: string; column: string }

/** Deletes rows of `table` created before `beforeIso` that nothing in `refs` points to any more,
 * in chunks. `statuses` optionally limits which rows may go. A row still referenced (e.g. a batch
 * holding a live order) is kept -- deleting it would break or cascade into live data. */
async function deleteUnreferenced(
  admin: SupabaseClient,
  table: string,
  idColumn: string,
  timeColumn: string,
  beforeIso: string,
  refs: Ref[],
  outOfTime: () => boolean,
  statuses?: string[],
): Promise<{ deleted: number; finished: boolean; error: string | null }> {
  type Row = Record<string, string>
  type Res = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
  const candidates = (
    await fetchAllRows<Row>((from, to) => {
      let q = admin.from(table).select(idColumn).lt(timeColumn, beforeIso)
      if (statuses) q = q.in('status', statuses)
      return q.order(idColumn).range(from, to) as unknown as Res
    })
  ).map((r) => r[idColumn])

  let deleted = 0
  for (let i = 0; i < candidates.length; i += CHUNK) {
    if (outOfTime()) return { deleted, finished: false, error: null }
    const ids = candidates.slice(i, i + CHUNK)
    const inUse = new Set<string>()
    for (const ref of refs) {
      // Paged: 100 batches can hold far more than the 1,000-row Max Rows cap of orders.
      const used = await fetchAllRows<Row>((from, to) => admin.from(ref.table).select(ref.column).in(ref.column, ids).order(ref.column).range(from, to) as unknown as Res)
      for (const r of used) inUse.add(r[ref.column])
    }
    const free = ids.filter((id) => !inUse.has(id))
    if (free.length === 0) continue
    const { count, error } = await admin.from(table).delete({ count: 'exact' }).in(idColumn, free)
    if (error) return { deleted, finished: false, error: `${table}: ${error.message}` }
    deleted += count ?? 0
  }
  return { deleted, finished: true, error: null }
}
