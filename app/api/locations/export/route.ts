import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { fetchAllRows } from '@/lib/queries/fetchAllRows'
import { formatLocationDisplay } from '@/lib/locations/locationDisplay'

/** Location Master — Export to Excel, same on-demand download pattern as Short Pick Monitor's own
 * export. Respects whatever search filters the Locations page currently has applied (so "Export"
 * downloads what's actually on screen, not always the whole table), and fetches every matching row
 * via fetchAllRows rather than the page's own RESULT_LIMIT/page-size cap -- an export is explicitly
 * the one place a filtered search SHOULD be able to return more than one screen's worth. */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const warehouse = searchParams.get('warehouse')
  const bin = searchParams.get('bin')
  const zone = searchParams.get('zone')

  const admin = createAdminClient()
  const rows = await fetchAllRows((from, to) => {
    let query = admin
      .from('locations')
      .select('bin_code, warehouse_code, zone_code, zone_name, aisle, side, bay, level, block, pick_sequence, active')
      .order('pick_sequence', { ascending: true })
      .range(from, to)
    if (warehouse) query = query.ilike('warehouse_code', `%${warehouse}%`)
    if (bin) query = query.ilike('bin_code', `%${bin}%`)
    if (zone) query = query.ilike('zone_code', `%${zone}%`)
    return query
  })

  const header = ['Bin Code', 'Warehouse', 'Zone', 'Zone Name', 'Aisle', 'Side', 'Bay', 'Level', 'Block', 'Pick Sequence', 'Active']
  const sheetRows = rows.map((l) => [
    formatLocationDisplay(l.bin_code),
    l.warehouse_code,
    l.zone_code,
    l.zone_name ?? '',
    l.aisle,
    l.side,
    l.bay,
    l.level,
    l.block,
    l.pick_sequence,
    l.active ? 'Active' : 'Inactive',
  ])
  const buffer = buildXlsxBuffer([{ name: 'Locations', rows: [header, ...sheetRows] }])

  const fileName = `BTM_LocationMaster${warehouse ? `_${warehouse}` : ''}.xlsx`
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    },
  })
}
