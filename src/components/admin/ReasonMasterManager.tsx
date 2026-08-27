'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ReasonRow {
  reason_code: string
  reason_type: string
  label_en: string
  label_th: string | null
  active: boolean
}

export function ReasonMasterManager({ reasons }: { reasons: ReasonRow[] }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [type, setType] = useState<'short_pick' | 'cancel'>('short_pick')
  const [labelEn, setLabelEn] = useState('')
  const [labelTh, setLabelTh] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addReason() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/reason-master', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason_code: code, reason_type: type, label_en: labelEn, label_th: labelTh || undefined }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    setCode('')
    setLabelEn('')
    setLabelTh('')
    router.refresh()
  }

  async function toggleActive(reason_code: string, active: boolean) {
    await fetch('/api/reason-master', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason_code, active: !active }),
    })
    router.refresh()
  }

  return (
    <div className="card">
      <div className="card-title">Reason Master</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        Short Pick + Cancel reasons — maintainable without a code change (§17.1)
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>CODE</th>
            <th>TYPE</th>
            <th>LABEL</th>
            <th>STATUS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {reasons.map((r) => (
            <tr key={r.reason_code}>
              <td style={{ fontWeight: 700 }}>{r.reason_code}</td>
              <td>{r.reason_type}</td>
              <td>
                {r.label_en}
                {r.label_th && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{r.label_th}</div>}
              </td>
              <td>{r.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
              <td>
                <button className="btn btn-secondary btn-sm" style={{ height: 28, padding: '0 10px' }} onClick={() => toggleActive(r.reason_code, r.active)}>
                  {r.active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <div className="field">
          <label className="field-label">Code</label>
          <input className="field-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Type</label>
          <select className="field-input" value={type} onChange={(e) => setType(e.target.value as 'short_pick' | 'cancel')} style={{ border: '1px solid var(--color-border)' }}>
            <option value="short_pick">Short Pick</option>
            <option value="cancel">Cancel</option>
          </select>
        </div>
        <div className="field">
          <label className="field-label">Label (EN)</label>
          <input className="field-input" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Label (TH)</label>
          <input className="field-input" value={labelTh} onChange={(e) => setLabelTh(e.target.value)} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!code || !labelEn || busy} onClick={addReason}>
          Add
        </button>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
    </div>
  )
}
