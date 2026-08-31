import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { UploadForm } from '@/components/UploadForm'
import { AddLocationForm } from '@/components/locations/AddLocationForm'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'

export default async function LocationMasterPage() {
  const user = await getSessionUser()
  const warehouseCode = user?.warehouse_code ?? 'DC002'
  const admin = createAdminClient()
  const [{ data: locations, count, error }, { data: aisleSequence, error: aisleError }] = await Promise.all([
    admin
      .from('locations')
      .select('bin_code, warehouse_code, zone_code, aisle, side, bay, level, block, pick_sequence, active', { count: 'exact' })
      .order('pick_sequence', { ascending: true })
      .limit(50),
    admin.from('aisle_sequence').select('aisle, aisle_rank').eq('warehouse_code', warehouseCode).order('aisle_rank'),
  ])
  if (error) console.error('[locations] locations error', error.message)
  if (aisleError) console.error('[locations] aisle_sequence error', aisleError.message)

  const existingAisles = aisleSequence ?? []
  const nextAisleRank = existingAisles.length > 0 ? Math.max(...existingAisles.map((a) => a.aisle_rank)) + 1 : 1

  return (
    <AppLayout activeNavId={14}>
      <TopBar title="Location Master" subtitle="ข้อมูลตำแหน่งจัดเก็บ · Bin → Zone → Pick Sequence" />
      <div className="page-body">
        <UploadForm
          endpoint="/api/imports/locations"
          label="Import Location Master"
          hint="Upload Bin Code master (.csv or .xlsx) — required columns: Bin Code, Warehouse Code, Zone Code, Aisle, Side, Bay, Level, Block (optional: Zone Name, Active Flag) — Pick Sequence is always computed, not read from the file"
        />

        <AddLocationForm warehouseCode={warehouseCode} existingAisles={existingAisles} nextAisleRank={nextAisleRank} />

        <div className="card" style={{ flex: 1, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 12 }}>
            <span className="card-title">Locations</span>
            <span className="card-subtitle">{count ?? 0} bin codes · showing first 50 by Pick Sequence</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>BIN CODE</th>
                <th>WAREHOUSE</th>
                <th>ZONE</th>
                <th>AISLE</th>
                <th>SIDE</th>
                <th>BAY</th>
                <th>LEVEL</th>
                <th>BLOCK</th>
                <th>PICK SEQ</th>
                <th>ACTIVE</th>
              </tr>
            </thead>
            <tbody>
              {(locations ?? []).map((l) => (
                <tr key={`${l.warehouse_code}-${l.bin_code}`}>
                  <td style={{ fontWeight: 700 }}>{l.bin_code}</td>
                  <td>{l.warehouse_code}</td>
                  <td>{l.zone_code}</td>
                  <td>{l.aisle}</td>
                  <td>{l.side}</td>
                  <td>{l.bay}</td>
                  <td>{l.level}</td>
                  <td>{l.block}</td>
                  <td>{l.pick_sequence}</td>
                  <td>{l.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                </tr>
              ))}
              {(!locations || locations.length === 0) && (
                <tr>
                  <td colSpan={10} style={{ color: 'var(--color-text-secondary)' }}>
                    No locations imported yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}
