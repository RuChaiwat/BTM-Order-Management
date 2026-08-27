import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'

/**
 * §20.2 retention purge — rolling `retention.transaction_days` (default 7), gated on the weekly
 * export having already succeeded for the period being purged (the safety rule is load-bearing:
 * this function returns WITHOUT deleting anything if the gate isn't satisfied).
 *
 * Deliberately conservative and NOT exhaustive of everything §20.2 lists as purgeable
 * ("matching candidates/history... derived dashboard aggregates") — this build purges only
 * orders/order_lines (+ their direct per-order children) and fully-orphaned old
 * consolidation_batches, which can be deleted with a clear, auditable blast radius per row.
 * import_batches/import_errors are deliberately left alone here: orders.import_id has no
 * cascade, and nulling it out first to make that chain safe is a follow-up, not guessed at
 * blind — see the code comment below. This is the single least-tested piece of the whole build
 * (no live DB in the environment it was written in) — review carefully, and consider running it
 * once manually against a staging copy before trusting the cron schedule with it.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) {
    const user = await getSessionUser()
    if (!user || user.role !== 'system_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = createAdminClient()

  const { data: retentionConfig } = await admin.from('configuration').select('value').eq('key', 'retention.transaction_days').eq('scope', 'global').eq('active', true).maybeSingle()
  const retentionDays = Number(retentionConfig?.value ?? 7)
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
    return NextResponse.json({ status: 'blocked', reason: `No successful weekly export covers the retention cutoff (${cutoffDateStr}) — purge safety gate not satisfied (§20.2)` }, { status: 409 })
  }

  const purgeCounts: Record<string, number> = {}

  // --- terminal, old orders only — never active/in-progress orders ---
  const { data: purgableOrders } = await admin
    .from('orders')
    .select('order_id')
    .in('status', ['final_closed_100', 'final_closed_short', 'cancelled'])
    .lt('original_order_date', cutoffDateStr)

  const orderIds = (purgableOrders ?? []).map((o) => o.order_id)

  if (orderIds.length > 0) {
    const { count: c1 } = await admin.from('picker_completions').delete({ count: 'exact' }).in('order_id', orderIds)
    const { count: c2 } = await admin.from('admin_verifications').delete({ count: 'exact' }).in('order_id', orderIds)
    const { count: c3 } = await admin.from('consolidation_orders').delete({ count: 'exact' }).in('order_id', orderIds)
    const { count: c4 } = await admin.from('assignment_orders').delete({ count: 'exact' }).in('order_id', orderIds)
    const { count: c5 } = await admin.from('status_history').delete({ count: 'exact' }).eq('entity_type', 'orders').in('entity_id', orderIds)
    // order_lines cascades automatically when the parent order is deleted (0001_init_schema.sql)
    const { count: c6 } = await admin.from('orders').delete({ count: 'exact' }).in('order_id', orderIds)

    purgeCounts.picker_completions = c1 ?? 0
    purgeCounts.admin_verifications = c2 ?? 0
    purgeCounts.consolidation_orders = c3 ?? 0
    purgeCounts.assignment_orders = c4 ?? 0
    purgeCounts.status_history = c5 ?? 0
    purgeCounts.orders = c6 ?? 0
  }

  // --- fully-orphaned old consolidation_batches (no consolidation_orders left referencing them) ---
  const { data: oldBatches } = await admin
    .from('consolidation_batches')
    .select('consol_batch_id')
    .in('status', ['completed', 'cancelled'])
    .lt('created_at', cutoff.toISOString())
  let consolidationBatchesPurged = 0
  for (const b of oldBatches ?? []) {
    const { count: remaining } = await admin.from('consolidation_orders').select('order_id', { count: 'exact', head: true }).eq('consol_batch_id', b.consol_batch_id)
    if ((remaining ?? 0) === 0) {
      await admin.from('consolidation_batches').delete().eq('consol_batch_id', b.consol_batch_id)
      consolidationBatchesPurged++
    }
  }
  purgeCounts.consolidation_batches = consolidationBatchesPurged

  for (const [table, rows] of Object.entries(purgeCounts)) {
    await admin.from('purge_log').insert({
      export_job_id: coveringExport.id,
      covered_period_start: cutoffDateStr,
      covered_period_end: cutoffDateStr,
      table_name: table,
      rows_purged: rows,
      result: 'success',
      executed_by: 'system',
    })
  }

  return NextResponse.json({ status: 'success', cutoff: cutoffDateStr, purged: purgeCounts })
}
