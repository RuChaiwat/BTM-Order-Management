import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getProductivityData } from '@/lib/queries/productivity'

/** Picker Productivity -- Export to Excel, same on-demand download pattern as the other export
 * buttons in the app. Carries a few columns the on-screen table doesn't show (Picker ID on its own,
 * and Pieces Short) since the sheet is meant to be handed off for payroll/performance review, not
 * just a copy of what's on screen. */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })

  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const data = await getProductivityData(admin, warehouseCode, date)

  const header = ['Picker ID', 'Picker Name', 'Orders Completed', 'Pieces Completed', 'Pieces Short', 'Round', 'PCS/HR', 'SLA %', 'Short Pick %']
  const sheetRows = data.pickerRows.map((p) => [p.user_id, p.name, p.completed, p.piecesCompleted, p.piecesShort, p.rounds, p.pcsPerHour ?? '', p.slaPct ?? '', p.shortRate ?? ''])
  const buffer = buildXlsxBuffer([{ name: 'Picker Productivity', rows: [header, ...sheetRows] }])

  const fileName = `BTM_PickerProductivity_${date}.xlsx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
