import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { canAccessMenuItem } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getMonthlyPackingHistory } from '@/lib/queries/packing'
import { formatDate, bangkokDateKey } from '@/lib/formatDate'

/** Packing Daily Productivity (this month, every packer combined) -- Export to Excel, same as
 * Picking Productivity's Daily Productivity export. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
  if (!canAccessMenuItem(user.role, 25)) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' }, { status: 403 })

  const admin = createAdminClient()
  const rows = await getMonthlyPackingHistory(admin, user.warehouse_code ?? 'DC002')

  const header = ['Date', 'Orders Completed', 'Pieces Completed', 'Avg Pcs/Hour', 'Issues (Order)', 'Issue (Pcs)']
  const sheetRows = rows.map((r) => [formatDate(r.date), r.orders, r.pieces, r.pcsPerHour ?? '', r.issues, r.issuePieces])
  const buffer = buildXlsxBuffer([{ name: 'Daily Productivity', rows: [header, ...sheetRows] }])

  const monthKey = (bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)).slice(0, 7)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BTM_PackingDailyProductivity_${monthKey}.xlsx"`,
    },
  })
}
