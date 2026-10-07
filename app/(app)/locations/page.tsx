import { redirect } from 'next/navigation'
import Link from 'next/link'
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

const PAGE_SIZE = 30

export default async function LocationMasterPage({ searchParams }: { searchParams: { warehouse?: string; bin?: string; zone?: string; page?: string } }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const admin = createAdminClient()

  // Server-side pagination, not a one-shot `.limit()` with no way to see anything past it --
  // Location Master easily runs into the thousands of bins for a real warehouse, so (unlike
  // Backlog/Consolidation History's "fetch a bounded set, paginate client-side") this fetches only
  // the current page's own 30 rows from Postgres, keyed off `?page=`.
  const page = Math.max(1, Number(searchParams.page ?? '1') || 1)
  const from = (page - 1) * PAGE_SIZE
  const to = from + PAGE_SIZE - 1

  let query = admin
    .from('locations')
    .select('bin_code, warehouse_code, zone_code, zone_name, aisle, side, bay, level, block, pick_sequence, active', { count: 'exact' })
    .order('pick_sequence', { ascending: true })
    .range(from, to)
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
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const filterParams = new URLSearchParams()
  if (searchParams.warehouse) filterParams.set('warehouse', searchParams.warehouse)
  if (searchParams.bin) filterParams.set('bin', searchParams.bin)
  if (searchParams.zone) filterParams.set('zone', searchParams.zone)
  const exportHref = `/api/locations/export${filterParams.toString() ? `?${filterParams.toString()}` : ''}`
  function pageHref(p: number) {
    const params = new URLSearchParams(filterParams)
    params.set('page', String(p))
    return `/locations?${params.toString()}`
  }

  return (
    <>
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
              รายการตำแหน่งจัดเก็บ · {total.toLocaleString()} bin code{total === 1 ? '' : 's'} match{isFiltered ? 'ing search' : ''} · sorted by Pick Sequence
            </span>
            <a
              className="btn btn-success btn-sm"
              style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6 }}
              href={exportHref}
              download
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 3v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Export to Excel
            </a>
          </div>
          <LocationSearchBar />
          <LocationTable locations={locations ?? []} />
          {total > 0 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12.5 }}>
              <span style={{ color: 'var(--color-text-secondary)' }}>
                Page {page} of {totalPages}
              </span>
              {page <= 1 ? (
                <span className="btn btn-secondary btn-sm" style={{ opacity: 0.5, pointerEvents: 'none' }}>
                  Prev
                </span>
              ) : (
                <Link href={pageHref(page - 1)} className="btn btn-secondary btn-sm">
                  Prev
                </Link>
              )}
              {page >= totalPages ? (
                <span className="btn btn-secondary btn-sm" style={{ opacity: 0.5, pointerEvents: 'none' }}>
                  Next
                </span>
              ) : (
                <Link href={pageHref(page + 1)} className="btn btn-secondary btn-sm">
                  Next
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  )
}
