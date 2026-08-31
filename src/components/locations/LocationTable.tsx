'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Location {
  bin_code: string
  warehouse_code: string
  zone_code: string
  zone_name?: string | null
  aisle: string
  side: string
  bay: string
  level: string
  block: string
  pick_sequence: string
  active: boolean
}

/** Click a row to open its detail panel (Active/Inactive lives here, not a modal — matches the
 * table + side-panel pattern used across the rest of the app, e.g. Admin Verification). */
export function LocationTable({ locations }: { locations: Location[] }) {
  const router = useRouter()
  const [selectedBin, setSelectedBin] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = locations.find((l) => l.bin_code === selectedBin) ?? null

  async function toggleActive() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/locations', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouse_code: selected.warehouse_code, bin_code: selected.bin_code, active: !selected.active }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    router.refresh()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 320px' : '1fr', gap: 14, minHeight: 0 }}>
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
          {locations.map((l) => (
            <tr key={`${l.warehouse_code}-${l.bin_code}`} className={l.bin_code === selectedBin ? 'row-flag' : undefined} onClick={() => setSelectedBin(l.bin_code)} style={{ cursor: 'pointer' }}>
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
          {locations.length === 0 && (
            <tr>
              <td colSpan={10} style={{ color: 'var(--color-text-secondary)' }}>
                No locations match — try a different search, or none imported yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {selected && (
        <div className="card" style={{ minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{selected.bin_code}</div>
              <div style={{ fontSize: 11.5, color: '#6B7280' }}>{selected.warehouse_code}</div>
            </div>
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setSelectedBin(null)}>
              Close
            </button>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12.5, marginBottom: 16 }}>
            <DetailField label="Zone" value={selected.zone_code} />
            {selected.zone_name && <DetailField label="Zone Name" value={selected.zone_name} />}
            <DetailField label="Aisle" value={selected.aisle} />
            <DetailField label="Side" value={selected.side} />
            <DetailField label="Bay" value={selected.bay} />
            <DetailField label="Level" value={selected.level} />
            <DetailField label="Block" value={selected.block} />
            <DetailField label="Pick Sequence" value={selected.pick_sequence} mono />
          </div>

          <div style={{ marginBottom: 14 }}>
            <span className={`badge badge-${selected.active ? 'success' : 'neutral'}`}>{selected.active ? 'Active' : 'Inactive'}</span>
          </div>

          {error && <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}

          <button className={`btn ${selected.active ? 'btn-danger-outline' : 'btn-success'}`} style={{ width: '100%' }} disabled={busy} onClick={toggleActive}>
            {busy ? 'Saving…' : selected.active ? 'Deactivate this Location' : 'Activate this Location'}
          </button>
          <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-secondary)' }}>
            Inactive locations are skipped by imports (Invalid Bin Code) and excluded from Zone/Pick Sequence lookups.
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 10px' }}>
      <div style={{ color: '#6B7280', fontSize: 11 }}>{label}</div>
      <div style={{ fontWeight: 700, fontFamily: mono ? 'monospace' : undefined }}>{value}</div>
    </div>
  )
}
