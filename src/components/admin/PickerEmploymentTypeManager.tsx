'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface EmploymentTypeRow {
  type_code: string
  label_en: string
  label_th: string | null
  active: boolean
}

/** Picker Employment Type master data (migration 0033) -- maintainable without a code deploy,
 * same pattern as Reason Master above. Referenced by pickers.employment_type and shown on Picker
 * List / Add Picker. */
export function PickerEmploymentTypeManager({ types }: { types: EmploymentTypeRow[] }) {
  const router = useRouter()
  const [code, setCode] = useState('')
  const [labelEn, setLabelEn] = useState('')
  const [labelTh, setLabelTh] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function addType() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/picker-employment-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_code: code, label_en: labelEn, label_th: labelTh || undefined }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    setCode('')
    setLabelEn('')
    setLabelTh('')
    router.refresh()
  }

  async function toggleActive(type_code: string, active: boolean) {
    await fetch('/api/picker-employment-types', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type_code, active: !active }),
    })
    router.refresh()
  }

  return (
    <div className="card">
      <div className="card-title">Picker Employment Type</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        ประเภทการจ้างงานของพนักงานหยิบสินค้า · shown on Picker List and Add Picker
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '18%' }} />
          <col style={{ width: '40%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '24%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>CODE</th>
            <th>LABEL</th>
            <th>STATUS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {types.map((t) => (
            <tr key={t.type_code}>
              <td style={{ fontWeight: 700 }}>{t.type_code}</td>
              <td style={{ overflowWrap: 'break-word' }}>
                {t.label_en}
                {t.label_th && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{t.label_th}</div>}
              </td>
              <td>{t.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
              <td>
                <button className="btn btn-secondary btn-sm" style={{ height: 28, padding: '0 10px' }} onClick={() => toggleActive(t.type_code, t.active)}>
                  {t.active ? 'Deactivate' : 'Activate'}
                </button>
              </td>
            </tr>
          ))}
          {types.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                No employment types yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <div className="field">
          <label className="field-label">Code</label>
          <input className="field-input" value={code} onChange={(e) => setCode(e.target.value.toLowerCase().replace(/\s+/g, '_'))} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Label (EN)</label>
          <input className="field-input" value={labelEn} onChange={(e) => setLabelEn(e.target.value)} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Label (TH)</label>
          <input className="field-input" value={labelTh} onChange={(e) => setLabelTh(e.target.value)} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!code || !labelEn || busy} onClick={addType}>
          Add
        </button>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
    </div>
  )
}
