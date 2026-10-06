import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getShortPickMonitorData } from '@/lib/queries/shortPickMonitor'
import { formatDateTime } from '@/lib/formatDate'
import { formatLocationDisplay } from '@/lib/locations/locationDisplay'

/** §Item 5 (Purge review follow-up): "Export รายการเพื่อส่งให้ทีม Inventory" -- a direct on-demand
 * download for one day (optionally one zone), not a scheduled job stored in Supabase Storage like
 * the weekly export (§20.1) -- this is meant to be handed to Inventory right after looking at the
 * page, not kept as a periodic snapshot file. */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date is required' }, { status: 400 })
  const zone = searchParams.get('zone')

  const admin = createAdminClient()
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const data = await getShortPickMonitorData(admin, warehouseCode, date)
  const rows = zone ? data.rows.filter((r) => r.zoneCode === zone) : data.rows

  const header = ['Order No', 'Store', 'Zone', 'SKU', 'Item Description', 'Bin', 'Reason (EN)', 'Reason (TH)', 'Ordered Qty', 'Picked Qty', 'Short Qty', 'Remark', 'Recorded At']
  const sheetRows = rows.map((r) => [
    r.orderNo,
    r.storeCode,
    r.zoneCode,
    r.sku,
    r.itemDescription ?? '',
    formatLocationDisplay(r.binCode),
    r.reasonLabelEn,
    r.reasonLabelTh,
    r.orderedQty,
    r.pickedQty,
    r.shortQty,
    r.remark ?? '',
    formatDateTime(r.recordedAt),
  ])
  const buffer = buildXlsxBuffer([{ name: 'Short-Damage-Expired', rows: [header, ...sheetRows] }])

  const fileName = `BTM_ShortDamageExpired_${date}${zone ? `_${zone}` : ''}.xlsx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
