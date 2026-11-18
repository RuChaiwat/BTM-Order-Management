import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { canAccessMenuItem } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getPackQueue } from '@/lib/queries/packing'
import { BACKLOG_META, isBacklogStatus } from '@/lib/packBacklog'
import { bangkokDateKey, formatDate, formatDateTime } from '@/lib/formatDate'

/** Pack backlog -- Export to Excel (same rows as /packing-dashboard/queue, ?status= all | pending |
 * packing | packed | issue). */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'กรุณาเข้าสู่ระบบ' }, { status: 401 })
  if (!canAccessMenuItem(user.role, 21)) return NextResponse.json({ error: 'คุณไม่มีสิทธิ์ทำรายการนี้' }, { status: 403 })

  const status = new URL(request.url).searchParams.get('status')
  const all = await getPackQueue(createAdminClient(), user.warehouse_code ?? 'DC002')
  const rows = isBacklogStatus(status) ? all.filter((r) => r.pack_status === status) : all
  const header = ['Order No', 'Store', 'Shipment Date', 'Pack Status', 'Pick Result', 'Items', 'Pieces', 'Verified At', 'Waiting (min)']
  const body = rows.map((r) => [r.order_no, r.store_code, formatDate(r.order_date), BACKLOG_META[r.pack_status].label, r.pick_status === 'final_closed_short' ? 'Short' : '100%', r.skus, r.pieces, formatDateTime(r.pack_ready_at), r.waitMinutes])
  const buffer = buildXlsxBuffer([{ name: 'Pack Backlog', rows: [header, ...body] }])
  const stamp = bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BTM_PackBacklog_${stamp}.xlsx"`,
    },
  })
}
