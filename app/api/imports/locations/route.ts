import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { parseSpreadsheet, col } from '@/lib/importers/parseSpreadsheet'
import { computePickSequence, directionForSide, sidePairCode } from '@/lib/locations/pickSequence'
import { getOrAssignAisleRanks } from '@/lib/locations/aisleRank'

/**
 * §6 Location Master upload — Excel/CSV, upserted on (warehouse_code, bin_code).
 *
 * Pick Sequence, Side Pair, and Direction are always COMPUTED here from Aisle/Side/Bay/Level/
 * Block, never read from the file — see src/lib/locations/pickSequence.ts for why: the source
 * file's own pre-computed values have a confirmed bug (Bay+Direction wraps past ~Bay 4-5 in every
 * Aisle), and a raw "Direction" column of Title Case 'Right'/'Left' wouldn't satisfy the
 * locations.direction check constraint ('RIGHT'/'LEFT') anyway. Aisle, Side, Bay, and Level are
 * therefore required fields, not optional — a row missing any of them can't get a Pick Sequence
 * and is skipped as an error rather than imported without one.
 */
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

  const parsed = rows
    .map((row) => ({
      bin_code: col(row, 'Bin Code', 'BinCode'),
      warehouse_code: col(row, 'Warehouse Code', 'WarehouseCode'),
      zone_code: col(row, 'Zone Code', 'ZoneCode'),
      zone_name: col(row, 'Zone Name', 'ZoneName') || null,
      aisle: col(row, 'Aisle'),
      side: col(row, 'Side'),
      bay: col(row, 'Bay'),
      level: col(row, 'Level'),
      block: col(row, 'Block'),
      active: col(row, 'Active Flag', 'Active').toLowerCase() !== 'false' && col(row, 'Active Flag', 'Active').toLowerCase() !== '0',
    }))
    .filter((r) => r.bin_code && r.warehouse_code)

  if (parsed.length === 0) {
    return NextResponse.json({ error: 'No valid rows found — required columns: Bin Code, Warehouse Code, Zone Code, Aisle, Side, Bay, Level, Block' }, { status: 400 })
  }

  const byWarehouse = new Map<string, typeof parsed>()
  for (const r of parsed) {
    if (!byWarehouse.has(r.warehouse_code)) byWarehouse.set(r.warehouse_code, [])
    byWarehouse.get(r.warehouse_code)!.push(r)
  }

  const records: Record<string, unknown>[] = []
  let skippedIncomplete = 0

  for (const [warehouseCode, whRows] of byWarehouse) {
    const aislesInOrder: string[] = []
    const seenAisles = new Set<string>()
    for (const r of whRows) {
      if (r.aisle && !seenAisles.has(r.aisle)) {
        seenAisles.add(r.aisle)
        aislesInOrder.push(r.aisle)
      }
    }
    const rankByAisle = await getOrAssignAisleRanks(admin, warehouseCode, aislesInOrder)

    for (const r of whRows) {
      if (!r.aisle || !r.side || !r.bay || !r.level || !r.block) {
        skippedIncomplete++
        continue
      }
      records.push({
        bin_code: r.bin_code,
        warehouse_code: r.warehouse_code,
        zone_code: r.zone_code,
        zone_name: r.zone_name,
        aisle: r.aisle,
        side: r.side.toUpperCase(),
        side_pair: sidePairCode(r.side),
        direction: directionForSide(r.side),
        bay: r.bay,
        level: r.level.toUpperCase(),
        block: r.block,
        pick_sequence: computePickSequence({ aisleRank: rankByAisle.get(r.aisle)!, side: r.side, bay: r.bay, level: r.level, block: r.block }),
        active: r.active,
      })
    }
  }

  if (records.length === 0) {
    return NextResponse.json({ error: 'No rows had Aisle, Side, Bay, and Level to compute a Pick Sequence from' }, { status: 400 })
  }

  // Chunked so a full Location Master reload (tens of thousands of bins in one file, per §6's
  // scale) doesn't send one multi-megabyte upsert that risks a request timeout.
  const UPSERT_CHUNK_SIZE = 2000
  let upsertedCount = 0
  for (let i = 0; i < records.length; i += UPSERT_CHUNK_SIZE) {
    const chunk = records.slice(i, i + UPSERT_CHUNK_SIZE)
    const { error, count } = await admin.from('locations').upsert(chunk, { onConflict: 'warehouse_code,bin_code', count: 'exact' })
    if (error) {
      return NextResponse.json({ error: `${error.message} (failed on rows ${i + 1}-${i + chunk.length} of ${records.length}; ${upsertedCount} rows already saved)` }, { status: 400 })
    }
    upsertedCount += count ?? chunk.length
  }

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'locations.import',
    entityType: 'locations',
    after: { row_count: records.length, file_name: file.name, skipped_incomplete: skippedIncomplete },
  })

  return NextResponse.json({ imported: upsertedCount, skipped: rows.length - records.length })
}
