import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { computePickSequence, directionForSide, sidePairCode } from '@/lib/locations/pickSequence'
import { getOrAssignAisleRanks } from '@/lib/locations/aisleRank'

/** Adds one Location (bin). Pick Sequence, Side Pair, and Direction are always computed from
 * Aisle/Side/Bay/Level/Block — see src/lib/locations/pickSequence.ts. A brand-new Aisle is
 * appended to the end of the walking order automatically. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { warehouse_code, bin_code, zone_code, zone_name, aisle, side, bay, level, block, active } = await request.json()
  const missing = [
    !warehouse_code && 'Warehouse',
    !bin_code && 'Bin Code',
    !zone_code && 'Zone Code',
    !aisle && 'Aisle',
    !side && 'Side',
    !bay && 'Bay',
    !level && 'Level',
    !block && 'Block',
  ].filter(Boolean)
  if (missing.length > 0) {
    return NextResponse.json({ error: `Required: ${missing.join(', ')}` }, { status: 400 })
  }
  if (!/^[A-Za-z]$/.test(side)) return NextResponse.json({ error: 'Side must be a single letter (A-Z)' }, { status: 400 })
  if (!/^[A-Za-z]$/.test(level)) return NextResponse.json({ error: 'Level must be a single letter (A-Z)' }, { status: 400 })

  const admin = createAdminClient()

  const { data: existing } = await admin.from('locations').select('bin_code').eq('warehouse_code', warehouse_code).eq('bin_code', bin_code).maybeSingle()
  if (existing) return NextResponse.json({ error: `Bin Code '${bin_code}' already exists for ${warehouse_code} — edit it instead of adding it again` }, { status: 409 })

  const rankByAisle = await getOrAssignAisleRanks(admin, warehouse_code, [aisle])
  const pickSequence = computePickSequence({ aisleRank: rankByAisle.get(aisle)!, side, bay, level, block })

  const { data: location, error } = await admin
    .from('locations')
    .insert({
      warehouse_code,
      bin_code,
      zone_code,
      zone_name: zone_name || null,
      aisle,
      side: side.toUpperCase(),
      side_pair: sidePairCode(side),
      direction: directionForSide(side),
      bay,
      level: level.toUpperCase(),
      block,
      pick_sequence: pickSequence,
      active: active ?? true,
    })
    .select()
    .single()
  if (error || !location) return NextResponse.json({ error: error?.message ?? 'Failed to create location' }, { status: 400 })

  await writeAudit(admin, { userId: caller.user_id, action: 'locations.create', entityType: 'locations', entityId: bin_code, after: location })

  return NextResponse.json({ location }, { status: 201 })
}
