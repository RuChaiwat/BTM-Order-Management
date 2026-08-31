'use client'

import { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function LocationSearchBar() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [warehouse, setWarehouse] = useState(searchParams.get('warehouse') ?? '')
  const [bin, setBin] = useState(searchParams.get('bin') ?? '')
  const [zone, setZone] = useState(searchParams.get('zone') ?? '')

  function apply() {
    const params = new URLSearchParams()
    if (warehouse.trim()) params.set('warehouse', warehouse.trim())
    if (bin.trim()) params.set('bin', bin.trim())
    if (zone.trim()) params.set('zone', zone.trim())
    router.push(params.size > 0 ? `/locations?${params.toString()}` : '/locations')
  }

  function clear() {
    setWarehouse('')
    setBin('')
    setZone('')
    router.push('/locations')
  }

  const hasFilter = warehouse || bin || zone

  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
      <input className="control" placeholder="Warehouse" value={warehouse} onChange={(e) => setWarehouse(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 120 }} />
      <input className="control" placeholder="Bin Code" value={bin} onChange={(e) => setBin(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 200 }} />
      <input className="control" placeholder="Zone Code" value={zone} onChange={(e) => setZone(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && apply()} style={{ width: 140 }} />
      <button className="btn btn-primary btn-sm" onClick={apply}>
        Search
      </button>
      {hasFilter && (
        <button className="btn btn-secondary btn-sm" onClick={clear}>
          Clear
        </button>
      )}
    </div>
  )
}
