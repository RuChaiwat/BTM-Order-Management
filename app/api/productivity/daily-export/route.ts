import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getMonthlyProductivityHistory } from '@/lib/queries/productivity'
import { formatDate, bangkokDateKey } from '@/lib/formatDate'

/** Daily Productivity (this month, every picker combined) -- Export to Excel, separate button
 * from Picker Productivity's own export since the two are different grains (per-picker-per-day
 * selected date vs. warehouse-wide-per-day this month). */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const rows = await getMonthlyProductivityHistory(admin, warehouseCode)

  const header = ['Date', 'Orders Completed', 'Pieces Completed', 'Avg Pcs/Hour', 'SLA Compliance %', 'Short Pick (Pcs)', 'Short Pick Rate %']
  const sheetRows = rows.map((r) => [formatDate(r.date), r.completedOrders, r.totalPieces, r.avgPcsPerHour ?? '', r.slaPct ?? '', r.shortPieces, r.shortRatePct ?? ''])
  const buffer = buildXlsxBuffer([{ name: 'Daily Productivity', rows: [header, ...sheetRows] }])

  const monthKey = (bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)).slice(0, 7)
  const fileName = `BTM_DailyProductivity_${monthKey}.xlsx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
