import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { canAccessMenuItem } from '@/lib/roles'
import { createAdminClient } from '@/lib/supabase/admin'
import { buildXlsxBuffer } from '@/lib/xlsxExport'
import { getPackingProductivity } from '@/lib/queries/packing'
import { getPackingSettings } from '@/lib/packing'
import { bangkokDateKey, formatDate } from '@/lib/formatDate'

/** Packing Productivity (one day) -- Export to Excel: per packer, per station, per hour. */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!canAccessMenuItem(user.role, 25)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const date = new URL(request.url).searchParams.get('date') || bangkokDateKey(new Date()) || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  const admin = createAdminClient()
  const [data, settings] = await Promise.all([getPackingProductivity(admin, user.warehouse_code ?? 'DC002', date), getPackingSettings(admin)])
  const target = settings.targetPcsPerHour

  const packers = [
    ['Date', 'Packer ID', 'Packer', 'Orders', 'Pieces (counted)', 'Pack time (min)', 'Pcs/Hour', 'Target Pcs/Hour', '% of target', 'Avg sec/order', 'Issues reported', 'Issue pieces', 'Stations'],
    ...data.packers.map((p) => [
      formatDate(date),
      p.picker_id,
      p.name,
      p.orders,
      p.pieces,
      Math.round(p.seconds / 6) / 10,
      p.pcsPerHour ?? '',
      target,
      p.pcsPerHour !== null && target > 0 ? Math.round((p.pcsPerHour / target) * 100) : '',
      p.avgSecondsPerOrder ?? '',
      p.issuesReported,
      p.issuePieces,
      p.stations.join(', '),
    ]),
  ]
  const stations = [['Station', 'Orders', 'Pieces (counted)', 'Pack time (min)', 'Pcs/Hour', 'Issues reported'], ...data.stations.map((s) => [s.station_code, s.orders, s.pieces, Math.round(s.seconds / 6) / 10, s.pcsPerHour ?? '', s.issuesReported])]
  const hourly = [['Hour', 'Orders', 'Pieces (counted)'], ...data.hourly.filter((h) => h.orders > 0).map((h) => [`${String(h.hour).padStart(2, '0')}:00`, h.orders, h.pieces])]
  const buffer = buildXlsxBuffer([
    { name: 'By Packer', rows: packers },
    { name: 'By Station', rows: stations },
    { name: 'By Hour', rows: hourly },
  ])
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="BTM_PackingProductivity_${date}.xlsx"`,
    },
  })
}
