'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface ConfigRow {
  key: string
  value: unknown
  version: number
}

export function ConfigEditor({ configs }: { configs: ConfigRow[] }) {
  const router = useRouter()
  const [key, setKey] = useState(configs[0]?.key ?? '')
  const [value, setValue] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    let parsedValue: unknown
    try {
      parsedValue = JSON.parse(value)
    } catch {
      setBusy(false)
      setError('Value must be valid JSON (e.g. 300, "text", true, ["a","b"])')
      return
    }
    const res = await fetch('/api/configuration', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: parsedValue, change_reason: reason }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    setValue('')
    setReason('')
    router.refresh()
  }

  return (
    <div className="card">
      <div className="card-title">Configuration</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        Effective-dated — a change creates a new version, in-progress batches keep the version they started with (§17)
      </div>
      <table className="table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>KEY</th>
            <th>VALUE</th>
            <th>VERSION</th>
          </tr>
        </thead>
        <tbody>
          {configs.map((c) => (
            <tr key={c.key}>
              <td style={{ fontWeight: 700 }}>{c.key}</td>
              <td style={{ fontFamily: 'ui-monospace, monospace', fontSize: 11.5 }}>{JSON.stringify(c.value)}</td>
              <td>{c.version}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ paddingTop: 14, borderTop: '1px dashed var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: 8, alignItems: 'end' }}>
        <div className="field">
          <label className="field-label">Key</label>
          <select className="field-input" value={key} onChange={(e) => setKey(e.target.value)} style={{ border: '1px solid var(--color-border)' }}>
            {configs.map((c) => (
              <option key={c.key} value={c.key}>
                {c.key}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label className="field-label">New value (JSON)</label>
          <input className="field-input" value={value} onChange={(e) => setValue(e.target.value)} placeholder="e.g. 300" style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Change reason</label>
          <input className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <button className="btn btn-primary btn-sm" disabled={!value || !reason || busy} onClick={save}>
          Save new version
        </button>
      </div>
      {error && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
    </div>
  )
}
