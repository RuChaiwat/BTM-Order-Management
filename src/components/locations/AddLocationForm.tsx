'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { computePickSequence } from '@/lib/locations/pickSequence'

interface AisleOption {
  aisle: string
  aisle_rank: number
}

const emptyForm = {
  bin_code: '',
  zone_code: '',
  zone_name: '',
  aisle: '',
  newAisle: '',
  side: '',
  bay: '',
  level: '',
  block: '',
  active: true,
}

export function AddLocationForm({ warehouseCode, existingAisles, nextAisleRank }: { warehouseCode: string; existingAisles: AisleOption[]; nextAisleRank: number }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [addingNewAisle, setAddingNewAisle] = useState(existingAisles.length === 0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const aisle = addingNewAisle ? form.newAisle.trim().toUpperCase() : form.aisle
  const aisleRank = addingNewAisle ? nextAisleRank : existingAisles.find((a) => a.aisle === form.aisle)?.aisle_rank

  const preview = useMemo(() => {
    if (!aisle || aisleRank === undefined || !/^[A-Za-z]$/.test(form.side) || !form.bay || !/^[A-Za-z]$/.test(form.level) || !form.block) return null
    try {
      return computePickSequence({ aisleRank, side: form.side, bay: form.bay, level: form.level, block: form.block })
    } catch {
      return null
    }
  }, [aisle, aisleRank, form.side, form.bay, form.level, form.block])

  const canSubmit = form.bin_code && form.zone_code && aisle && preview !== null

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_code: warehouseCode,
        bin_code: form.bin_code.trim(),
        zone_code: form.zone_code.trim(),
        zone_name: form.zone_name.trim() || undefined,
        aisle,
        side: form.side,
        bay: form.bay,
        level: form.level,
        block: form.block,
        active: form.active,
      }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    setForm(emptyForm)
    setAddingNewAisle(existingAisles.length === 0)
    router.refresh()
  }

  if (!open) {
    return (
      <button className="btn btn-primary btn-sm" onClick={() => setOpen(true)}>
        + Add Location
      </button>
    )
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <span className="card-title">Add Location</span>
        <span className="card-subtitle" style={{ marginLeft: 8 }}>
          Pick Sequence is computed automatically — not entered by hand
        </span>
        <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        <div className="field">
          <label className="field-label">Bin Code *</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} value={form.bin_code} onChange={(e) => setForm({ ...form, bin_code: e.target.value })} placeholder="e.g. A1A-01-A01" />
        </div>
        <div className="field">
          <label className="field-label">Zone Code *</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} value={form.zone_code} onChange={(e) => setForm({ ...form, zone_code: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label">Zone Name</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} value={form.zone_name} onChange={(e) => setForm({ ...form, zone_name: e.target.value })} />
        </div>
        <div className="field">
          <label className="field-label">Active</label>
          <select className="field-input" style={{ border: '1px solid var(--color-border)' }} value={form.active ? '1' : '0'} onChange={(e) => setForm({ ...form, active: e.target.value === '1' })}>
            <option value="1">Active</option>
            <option value="0">Inactive</option>
          </select>
        </div>

        <div className="field">
          <label className="field-label">
            Aisle * <span className="field-hint">walking order — new aisles go to the end</span>
          </label>
          {!addingNewAisle ? (
            <select
              className="field-input"
              style={{ border: '1px solid var(--color-border)' }}
              value={form.aisle}
              onChange={(e) => (e.target.value === '__new__' ? setAddingNewAisle(true) : setForm({ ...form, aisle: e.target.value }))}
            >
              <option value="">Select aisle…</option>
              {existingAisles.map((a) => (
                <option key={a.aisle} value={a.aisle}>
                  {a.aisle} (rank {a.aisle_rank})
                </option>
              ))}
              <option value="__new__">+ New aisle (append to end)…</option>
            </select>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="field-input"
                style={{ border: '1px solid var(--color-border)' }}
                value={form.newAisle}
                onChange={(e) => setForm({ ...form, newAisle: e.target.value })}
                placeholder={`new aisle — will be rank ${nextAisleRank}`}
              />
              {existingAisles.length > 0 && (
                <button className="btn btn-secondary btn-sm" onClick={() => setAddingNewAisle(false)}>
                  Pick existing
                </button>
              )}
            </div>
          )}
        </div>
        <div className="field">
          <label className="field-label">Side * (A-Z)</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} maxLength={1} value={form.side} onChange={(e) => setForm({ ...form, side: e.target.value.toUpperCase() })} placeholder="A" />
        </div>
        <div className="field">
          <label className="field-label">Bay *</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} value={form.bay} onChange={(e) => setForm({ ...form, bay: e.target.value })} placeholder="01" />
        </div>
        <div className="field">
          <label className="field-label">Level * (A-Z)</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} maxLength={1} value={form.level} onChange={(e) => setForm({ ...form, level: e.target.value.toUpperCase() })} placeholder="A" />
        </div>
        <div className="field">
          <label className="field-label">Block *</label>
          <input className="field-input" style={{ border: '1px solid var(--color-border)' }} value={form.block} onChange={(e) => setForm({ ...form, block: e.target.value })} placeholder="01" />
        </div>
      </div>

      <div style={{ marginTop: 14, background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px', fontSize: 12.5 }}>
        <span style={{ color: '#6B7280' }}>Pick Sequence preview</span>
        <div style={{ fontSize: 16, fontWeight: 700, fontFamily: 'monospace' }}>{preview ?? '—'}</div>
      </div>

      {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}

      <div style={{ marginTop: 14 }}>
        <button className="btn btn-primary btn-sm" disabled={!canSubmit || busy} onClick={submit}>
          {busy ? 'Saving…' : 'Save Location'}
        </button>
      </div>
    </div>
  )
}
