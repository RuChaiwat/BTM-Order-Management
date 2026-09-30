import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getSessionUser } from '@/lib/auth'
import { bangkokDateKey, formatDate, formatDateTime } from '@/lib/formatDate'
import { getShortPickDetailRows } from '@/lib/queries/shortPickMonitor'

/**
 * §20.1 weekly productivity export — one row per Order productivity result, into a new
 * BTM_Productivity_YYYY-Www.xlsx file. Triggered by Vercel Cron (vercel.json) on the schedule
 * that should mirror the `export.weekly_day_time_tz` configuration value — Vercel Cron schedules
 * are static at deploy time, not readable from the DB at runtime, so keep vercel.json's cron
 * expression in sync by hand if that config value changes (a platform constraint, not an
 * oversight).
 *
 * Was a Google Sheets export (service-account JSON + a shared Drive folder) -- dropped in favor of
 * a plain .xlsx file in Supabase Storage (see migration 0029) because the Google Cloud setup this
 * needed looked like it would incur billing to the business, for a feature that's really just a
 * periodic snapshot file, not a live collaborative sheet. Same `xlsx` package already used to
 * parse uploaded order/location spreadsheets on import, just its write side.
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
      .select('completion_id, order_id, actual_pieces, result, picker_completed_time, short_reason_code')
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

    // Computed once per completion (assigned_time -> picker_completed_time, same basis as
    // Productivity's own per-day view) and reused for both the Order Detail rows and the Picker
    // Daily Summary sheet below, so the two can't ever disagree with each other.
    const enriched = (completions ?? []).map((c) => {
      const order = orderById.get(c.order_id)
      const pickerId = order?.assignment_batch_id ? pickerByBatch.get(order.assignment_batch_id) : null
      const cycleMinutes = order?.assigned_time ? (new Date(c.picker_completed_time).getTime() - new Date(order.assigned_time).getTime()) / 60000 : 0
      const pcsPerHour = cycleMinutes > 0 ? Math.round((c.actual_pieces / cycleMinutes) * 60) : 0
      return { c, order, pickerId, cycleMinutes, pcsPerHour }
    })

    const detailHeader = [
      'Order No', 'Original Order Date', 'Store', 'Warehouse Code', 'Picker',
      'Assigned Time', 'Picker Completed Time', 'Planned Pieces', 'Actual Pieces',
      'Cycle Minutes', 'Pieces/Hour', 'Completion Result', 'Short Pick Reason', 'Zone Contribution',
    ]
    const detailRows = enriched.map(({ c, order, pickerId, cycleMinutes, pcsPerHour }) => [
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
    ])

    const controlTotals = {
      rowCount: detailRows.length,
      totalPlannedPieces: detailRows.reduce((s, r) => s + Number(r[7]), 0),
      totalActualPieces: detailRows.reduce((s, r) => s + Number(r[8]), 0),
      completedOrders: detailRows.length,
      shortPickOrders: detailRows.filter((r) => r[11] === 'short').length,
    }

    // Picker Daily Summary -- grouped by (picker, Bangkok-calendar day). Avg Cycle Minutes is a
    // plain per-order mean (typical order duration); Avg Pieces/Hour is total pieces over total
    // minutes for the group (throughput), not a mean of each order's own rate -- same convention
    // Productivity's own per-day view uses, so one short order can't skew it disproportionately.
    const summaryByKey = new Map<string, { pickerId: string; day: string; orders: number; totalPieces: number; totalMinutes: number }>()
    for (const { c, order, pickerId, cycleMinutes } of enriched) {
      if (!pickerId || !order?.assigned_time) continue
      const day = bangkokDateKey(c.picker_completed_time)
      if (!day) continue
      const key = `${pickerId}__${day}`
      const entry = summaryByKey.get(key) ?? { pickerId, day, orders: 0, totalPieces: 0, totalMinutes: 0 }
      entry.orders += 1
      entry.totalPieces += c.actual_pieces ?? 0
      entry.totalMinutes += cycleMinutes
      summaryByKey.set(key, entry)
    }

    const pickerIdsForSummary = [...new Set([...summaryByKey.values()].map((s) => s.pickerId))]
    const { data: summaryPickers } = pickerIdsForSummary.length
      ? await admin.from('pickers').select('picker_id, name_en').in('picker_id', pickerIdsForSummary)
      : { data: [] as { picker_id: string; name_en: string }[] }
    const nameByPicker = new Map((summaryPickers ?? []).map((p) => [p.picker_id, p.name_en]))

    const summaryHeader = ['Picker ID', 'Picker Name', 'Date', 'Orders Completed', 'Total Pieces', 'Avg Cycle Minutes', 'Avg Pieces/Hour']
    const summaryRows = [...summaryByKey.values()]
      .sort((a, b) => a.day.localeCompare(b.day) || a.pickerId.localeCompare(b.pickerId))
      .map((s) => [
        s.pickerId,
        nameByPicker.get(s.pickerId) ?? s.pickerId,
        formatDate(s.day),
        s.orders,
        s.totalPieces,
        Math.round(s.totalMinutes / s.orders),
        s.totalMinutes > 0 ? Math.round((s.totalPieces / s.totalMinutes) * 60) : 0,
      ])

    // Short / Damage / Expired sheet (Purge review follow-up, item 2) -- item-level detail, same
    // source and warehouse-agnostic scope as the rest of this export. Reason detail only exists
    // once Admin has Final Closed the order (see getShortPickDetailRows), so this naturally lists
    // fewer rows than "Order Detail"'s short-result orders until Admin catches up on verification.
    const shortDetailRows = await getShortPickDetailRows(admin, undefined, completions ?? [])
    const shortDetailHeader = ['Order No', 'Store', 'Warehouse Code', 'Zone', 'SKU', 'Item Description', 'Bin', 'Reason (EN)', 'Reason (TH)', 'Ordered Qty', 'Picked Qty', 'Short Qty', 'Remark', 'Recorded At']
    const shortDetailSheetRows = shortDetailRows.map((r) => [
      r.orderNo,
      r.storeCode,
      r.warehouseCode,
      r.zoneCode,
      r.sku,
      r.itemDescription ?? '',
      r.binCode,
      r.reasonLabelEn,
      r.reasonLabelTh,
      r.orderedQty,
      r.pickedQty,
      r.shortQty,
      r.remark ?? '',
      formatDateTime(r.recordedAt),
    ])

    const storagePath = `weekly/${title}.xlsx`
    const buffer = buildXlsxBuffer([
      { name: 'Order Detail', rows: [detailHeader, ...detailRows] },
      { name: 'Picker Daily Summary', rows: [summaryHeader, ...summaryRows] },
      { name: 'Short-Damage-Expired', rows: [shortDetailHeader, ...shortDetailSheetRows] },
    ])
    const { error: uploadError } = await admin.storage
      .from('exports')
      .upload(storagePath, buffer, { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', upsert: true })
    if (uploadError) throw new Error(`Supabase Storage upload failed: ${uploadError.message}`)

    await admin
      .from('export_jobs')
      .update({
        status: 'success',
        row_count: controlTotals.rowCount,
        control_totals: { ...controlTotals, storagePath },
        target_ref: `/api/exports/${job.id}/download`,
        finished_at: new Date().toISOString(),
      })
      .eq('id', job.id)

    return NextResponse.json({ status: 'success', download: `/api/exports/${job.id}/download`, ...controlTotals })
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
