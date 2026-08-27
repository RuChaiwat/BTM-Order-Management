import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createWeeklySpreadsheet, writeSheetValues } from '@/lib/google/sheetsExport'
import { getSessionUser } from '@/lib/auth'

/**
 * §20.1 weekly productivity export — one row per Order productivity result, into a new
 * BTM_Productivity_YYYY-Www spreadsheet. Triggered by Vercel Cron (vercel.json) on the schedule
 * that should mirror the `export.weekly_day_time_tz` configuration value — Vercel Cron schedules
 * are static at deploy time, not readable from the DB at runtime, so keep vercel.json's cron
 * expression in sync by hand if that config value changes (a platform constraint, not an
 * oversight).
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

  const now = new Date()
  const periodEnd = now
  const periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
  const { isoYear, isoWeek } = isoWeekOf(periodEnd)
  const title = `BTM_Productivity_${isoYear}-W${String(isoWeek).padStart(2, '0')}`

  const { data: job } = await admin
    .from('export_jobs')
    .insert({ job_type: 'weekly_productivity_export', status: 'running', period_start: periodStart.toISOString().slice(0, 10), period_end: periodEnd.toISOString().slice(0, 10), started_at: now.toISOString() })
    .select()
    .single()

  try {
    const { data: completions } = await admin
      .from('picker_completions')
      .select('order_id, actual_pieces, result, picker_completed_time, short_reason_code')
      .gte('picker_completed_time', periodStart.toISOString())
      .lt('picker_completed_time', periodEnd.toISOString())

    const orderIds = (completions ?? []).map((c) => c.order_id)
    const { data: orders } = orderIds.length
      ? await admin.from('orders').select('order_id, order_no, original_order_date, store_code, warehouse_code, planned_pieces, assigned_time, assignment_batch_id').in('order_id', orderIds)
      : { data: [] as { order_id: string; order_no: string; original_order_date: string; store_code: string; warehouse_code: string; planned_pieces: number; assigned_time: string | null; assignment_batch_id: string | null }[] }
    const orderById = new Map((orders ?? []).map((o) => [o.order_id, o]))

    const batchIds = [...new Set((orders ?? []).map((o) => o.assignment_batch_id).filter(Boolean))] as string[]
    const { data: batches } = batchIds.length
      ? await admin.from('assignment_batches').select('assignment_batch_id, picker_id').in('assignment_batch_id', batchIds)
      : { data: [] as { assignment_batch_id: string; picker_id: string | null }[] }
    const pickerByBatch = new Map((batches ?? []).map((b) => [b.assignment_batch_id, b.picker_id]))

    const orderLinesRes = orderIds.length ? await admin.from('order_lines').select('order_id, zone_code, qty').in('order_id', orderIds) : { data: [] as { order_id: string; zone_code: string | null; qty: number }[] }
    const zonesByOrder = new Map<string, Set<string>>()
    for (const l of orderLinesRes.data ?? []) {
      if (!l.zone_code) continue
      if (!zonesByOrder.has(l.order_id)) zonesByOrder.set(l.order_id, new Set())
      zonesByOrder.get(l.order_id)!.add(l.zone_code)
    }

    const header = [
      'Order No', 'Original Order Date', 'Store', 'Warehouse Code', 'Picker',
      'Assigned Time', 'Picker Completed Time', 'Planned Pieces', 'Actual Pieces',
      'Cycle Minutes', 'Pieces/Hour', 'Completion Result', 'Short Pick Reason', 'Zone Contribution',
    ]
    const rows = (completions ?? []).map((c) => {
      const order = orderById.get(c.order_id)
      const pickerId = order?.assignment_batch_id ? pickerByBatch.get(order.assignment_batch_id) : null
      const cycleMinutes = order?.assigned_time ? (new Date(c.picker_completed_time).getTime() - new Date(order.assigned_time).getTime()) / 60000 : 0
      const pcsPerHour = cycleMinutes > 0 ? Math.round((c.actual_pieces / cycleMinutes) * 60) : 0
      return [
        order?.order_no ?? c.order_id,
        order?.original_order_date ?? '',
        order?.store_code ?? '',
        order?.warehouse_code ?? '',
        pickerId ?? '',
        order?.assigned_time ?? '',
        c.picker_completed_time,
        order?.planned_pieces ?? 0,
        c.actual_pieces,
        Math.round(cycleMinutes),
        pcsPerHour,
        c.result,
        c.short_reason_code ?? '',
        [...(zonesByOrder.get(c.order_id) ?? [])].join(', '),
      ]
    })

    const controlTotals = {
      rowCount: rows.length,
      totalPlannedPieces: rows.reduce((s, r) => s + Number(r[7]), 0),
      totalActualPieces: rows.reduce((s, r) => s + Number(r[8]), 0),
      completedOrders: rows.length,
      shortPickOrders: rows.filter((r) => r[11] === 'short').length,
    }

    const { spreadsheetId, url } = await createWeeklySpreadsheet(title, process.env.GOOGLE_DRIVE_FOLDER_ID!)
    await writeSheetValues(spreadsheetId, 'Sheet1!A1', [header, ...rows])

    await admin
      .from('export_jobs')
      .update({ status: 'success', row_count: controlTotals.rowCount, control_totals: controlTotals, target_ref: url, finished_at: new Date().toISOString() })
      .eq('id', job.id)

    return NextResponse.json({ status: 'success', spreadsheet: url, ...controlTotals })
  } catch (e) {
    await admin.from('export_jobs').update({ status: 'failed', error_detail: (e as Error).message, finished_at: new Date().toISOString() }).eq('id', job.id)
    return NextResponse.json({ status: 'failed', error: (e as Error).message }, { status: 500 })
  }
}

function isoWeekOf(date: Date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1))
  const isoWeek = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)
  return { isoYear: d.getUTCFullYear(), isoWeek }
}
