import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { parseSpreadsheet, col } from '@/lib/importers/parseSpreadsheet'

/** §6 Location Master upload — Excel/CSV, upserted on (warehouse_code, bin_code). */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const formData = await request.formData()
  const file = formData.get('file')
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'file is required (multipart/form-data)' }, { status: 400 })
  }

  const rows = await parseSpreadsheet(file)
  const admin = createAdminClient()

  const records = rows
    .map((row) => ({
      bin_code: col(row, 'Bin Code', 'BinCode'),
      warehouse_code: col(row, 'Warehouse Code', 'WarehouseCode'),
      zone_code: col(row, 'Zone Code', 'ZoneCode'),
      zone_name: col(row, 'Zone Name', 'ZoneName') || null,
      aisle: col(row, 'Aisle') || null,
      side: col(row, 'Side') || null,
      side_pair: col(row, 'Side Pair', 'SidePair') || null,
      direction: col(row, 'Direction') || null,
      bay: col(row, 'Bay') || null,
      level: col(row, 'Level') || null,
      block: col(row, 'Block') || null,
      pick_sequence: col(row, 'Pick Sequence', 'PickSequence') || null,
      active: col(row, 'Active Flag', 'Active').toLowerCase() !== 'false' && col(row, 'Active Flag', 'Active').toLowerCase() !== '0',
    }))
    .filter((r) => r.bin_code && r.warehouse_code)

  if (records.length === 0) {
    return NextResponse.json({ error: 'No valid rows found — required columns: Bin Code, Warehouse Code, Zone Code' }, { status: 400 })
  }

  const { error, count } = await admin
    .from('locations')
    .upsert(records, { onConflict: 'warehouse_code,bin_code', count: 'exact' })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'locations.import',
    entityType: 'locations',
    after: { row_count: records.length, file_name: file.name },
  })

  return NextResponse.json({ imported: count ?? records.length, skipped: rows.length - records.length })
}
