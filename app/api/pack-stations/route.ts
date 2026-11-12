import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'

const PACK_ADMIN_ROLES = ['system_admin', 'pack_supervisor']

/** Pack Station master (Pack Settings). The code is what's printed as the station barcode and
 * scanned first on the Pack Handheld; never hard-deleted (pack history references it). */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const body = await request.json()
  const code = String(body.station_code ?? '').trim().toUpperCase()
  const name = String(body.name ?? '').trim()
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) return NextResponse.json({ error: 'Station code must be 1-20 characters (A-Z, 0-9, - or _) · รหัส Station ไม่ถูกต้อง' }, { status: 400 })
  if (!name) return NextResponse.json({ error: 'Station name is required · ต้องกรอกชื่อ Station' }, { status: 400 })

  const admin = createAdminClient()
  const { data, error } = await admin
    .from('pack_stations')
    .insert({ station_code: code, name, warehouse_code: caller.warehouse_code ?? body.warehouse_code ?? null, created_by: caller.user_id, updated_by: caller.user_id })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.code === '23505' ? `Station ${code} มีอยู่แล้ว · already exists` : error.message }, { status: 400 })

  await writeAudit(admin, { userId: caller.user_id, action: 'pack_station.create', entityType: 'pack_stations', entityId: code, after: data })
  return NextResponse.json({ station: data }, { status: 201 })
}

export async function PATCH(request: Request) {
  let caller
  try {
    caller = await requireRole(PACK_ADMIN_ROLES)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const { station_code, name, active } = await request.json()
  if (!station_code) return NextResponse.json({ error: 'station_code is required' }, { status: 400 })

  const admin = createAdminClient()
  const { data: before } = await admin.from('pack_stations').select('*').eq('station_code', station_code).maybeSingle()
  if (!before) return NextResponse.json({ error: 'Station not found' }, { status: 404 })
  if (caller.warehouse_code && before.warehouse_code && before.warehouse_code !== caller.warehouse_code) {
    return NextResponse.json({ error: 'This station belongs to another warehouse' }, { status: 403 })
  }

  const patch: Record<string, unknown> = { updated_by: caller.user_id, updated_at: new Date().toISOString() }
  if (typeof name === 'string') {
    if (!name.trim()) return NextResponse.json({ error: 'Station name is required' }, { status: 400 })
    patch.name = name.trim()
  }
  if (typeof active === 'boolean') {
    if (!active) {
      const { count } = await admin.from('pack_sessions').select('session_id', { count: 'exact', head: true }).eq('station_code', station_code).is('finished_at', null)
      if ((count ?? 0) > 0) return NextResponse.json({ error: 'มีงานกำลังแพ็กค้างอยู่ที่ Station นี้ ปิดใช้งานไม่ได้ · Station has an order being packed' }, { status: 409 })
    }
    patch.active = active
  }

  const { data: after, error } = await admin.from('pack_stations').update(patch).eq('station_code', station_code).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  await writeAudit(admin, { userId: caller.user_id, action: 'pack_station.update', entityType: 'pack_stations', entityId: station_code, before, after })
  return NextResponse.json({ station: after })
}
