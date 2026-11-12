import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { canAccessMenuItem } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getPackQueue } from '@/lib/queries/packing'
import { bangkokDateKey, formatDate, formatDateTime } from '@/lib/formatDate'

/** Orders waiting to pack -- Export to Excel (same rows as /packing-dashboard/queue). */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccessMenuItem(user.role, 21)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const rows = await getPackQueue(createAdminClient(), user.warehouse_code ?? 'DC002')
  const header = ['Order No', 'Store', 'Shipment Date', 'Pick Result', 'Items', 'Pieces', 'Verified At', 'Waiting (min)']
  const body = rows.map((r) => [r.order_no, r.store_code, formatDate(r.order_date), r.pick_status === 'final_closed_short' ? 'Short' : '100%', r.skus, r.pieces, formatDateTime(r.pack_ready_at), r.waitMinutes])
  const buffer = buildXlsxBuffer([{ name: 'Waiting to Pack', rows: [header, ...body] }])
  const stamp = bangkokDateKey(new Date()) ?? new Date().toISOString().slice(0, 10)
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BTM_WaitingToPack_${stamp}.xlsx"`,
    },
  })
}
