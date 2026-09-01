import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { UploadForm } from '@/components/UploadForm'
import { AddLocationForm } from '@/components/locations/AddLocationForm'
import { LocationSearchBar } from '@/components/locations/LocationSearchBar'
import { LocationTable } from '@/components/locations/LocationTable'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

const RESULT_LIMIT = 100

export default async function LocationMasterPage({ searchParams }: { searchParams: { warehouse?: string; bin?: string; zone?: string } }) {
  const user = await getSessionUser()
  const warehouseCode = user?.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  let query = admin
    .from('locations')
    .select('bin_code, warehouse_code, zone_code, zone_name, aisle, side, bay, level, block, pick_sequence, active', { count: 'exact' })
    .order('pick_sequence', { ascending: true })
    .limit(RESULT_LIMIT)
  if (searchParams.warehouse) query = query.ilike('warehouse_code', `%${searchParams.warehouse}%`)
  if (searchParams.bin) query = query.ilike('bin_code', `%${searchParams.bin}%`)
  if (searchParams.zone) query = query.ilike('zone_code', `%${searchParams.zone}%`)

  const [{ data: locations, count, error }, { data: aisleSequence, error: aisleError }] = await Promise.all([
    query,
    admin.from('aisle_sequence').select('aisle, aisle_rank').eq('warehouse_code', warehouseCode).order('aisle_rank'),
  ])
  if (error) console.error('[locations] locations error', error.message)
  if (aisleError) console.error('[locations] aisle_sequence error', aisleError.message)

  const existingAisles = aisleSequence ?? []
  const nextAisleRank = existingAisles.length > 0 ? Math.max(...existingAisles.map((a) => a.aisle_rank)) + 1 : 1
  const isFiltered = Boolean(searchParams.warehouse || searchParams.bin || searchParams.zone)
  const total = count ?? 0

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
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span className="card-title">Locations</span>
            <span className="card-subtitle">
              {total} bin code{total === 1 ? '' : 's'} match{isFiltered ? 'ing search' : ''} · showing first {Math.min(total, RESULT_LIMIT)} by Pick Sequence
              {total > RESULT_LIMIT ? ' — refine your search to see more' : ''}
            </span>
          </div>
          <LocationSearchBar />
          <LocationTable locations={locations ?? []} />
        </div>
      </div>
    </AppLayout>
  )
}
