import { redirect } from 'next/navigation'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessMenuItem } from '@/lib/roles'
import { Barcode } from '@/components/Barcode'
import { PrintButton } from '@/components/PrintButton'

export const dynamic = 'force-dynamic'

const CSS = `
.station-sheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; padding: 16px; }
.station-label { border: 2px solid #111; border-radius: 10px; padding: 18px; text-align: center; break-inside: avoid; }
.station-label h1 { font-size: 30px; margin: 0 0 4px; }
.station-label p { font-size: 15px; margin: 0 0 10px; color: #374151; }
@media print { .no-print { display: none !important; } body { background: #fff; } }
`

/** Printable Pack Station barcode labels (Pack Settings > Print), to stick on each packing table.
 * The barcode encodes the station code -- exactly what the Pack Handheld expects as its first scan. */
export default async function PackStationPrintPage({ searchParams }: { searchParams: { codes?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  if (!canAccessMenuItem(user.role, 27)) redirect('/dashboard')
  const codes = (searchParams.codes ?? '')
    .split(',')
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean)
  const { data: stations } = codes.length ? await createAdminClient().from('pack_stations').select('station_code, name').in('station_code', codes).order('station_code') : { data: [] }

  return (
    <div>
      <style>{CSS}</style>
      <div className="no-print" style={{ padding: 16, display: 'flex', gap: 12, alignItems: 'center' }}>
        <PrintButton />
        <span style={{ color: '#6B7280', fontSize: 13 }}>{(stations ?? []).length} station(s)</span>
      </div>
      <div className="station-sheet">
        {(stations ?? []).map((s) => (
          <div key={s.station_code} className="station-label">
            <h1>{s.station_code}</h1>
            <p>{s.name}</p>
            <Barcode value={s.station_code} height={70} width={2.4} fontSize={18} />
          </div>
        ))}
      </div>
    </div>
  )
}
