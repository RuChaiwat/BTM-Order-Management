'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { apiFetch } from '../../lib/apiFetch'

interface StationRow {
  station_code: string
  name: string
  active: boolean
}
interface ReasonRow {
  reason_code: string
  label_en: string
  label_th: string | null
  active: boolean
}

const input: React.CSSProperties = { border: '1px solid var(--color-border)' }

async function send(url: string, method: 'POST' | 'PATCH', payload: Record<string, unknown>) {
  const res = await apiFetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const body = await res.json()
  if (!res.ok) throw new Error(body.error)
  return body
}

/** Pack Settings: the Pack Supervisor's own master data -- Pack Stations (scanned first on the
 * Pack Handheld; barcodes printable here) and the problem list for Completed with Short. */
export function PackSettingsBoard({ stations, reasons }: { stations: StationRow[]; reasons: ReasonRow[] }) {
  const router = useRouter()
  const [stCode, setStCode] = useState('')
  const [stName, setStName] = useState('')
  const [rsCode, setRsCode] = useState('')
  const [rsTh, setRsTh] = useState('')
  const [rsEn, setRsEn] = useState('')
  const [busy, setBusy] = useState(false)
  const [stError, setStError] = useState<string | null>(null)
  const [rsError, setRsError] = useState<string | null>(null)

  async function run(fn: () => Promise<unknown>, setErr: (e: string | null) => void, after?: () => void) {
    setBusy(true)
    setErr(null)
    try {
      await fn()
      after?.()
      router.refresh()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const activeCodes = stations.filter((s) => s.active).map((s) => s.station_code)

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 12 }}>
          <div>
            <div className="card-title">Pack Stations</div>
            <div className="card-subtitle">โต๊ะแพ็ก · พนักงาน scan บาร์โค้ด Station ก่อนเริ่มงานทุก order</div>
          </div>
          <a className="btn btn-info btn-sm" style={{ marginLeft: 'auto' }} href={`/pack-stations/print?codes=${encodeURIComponent(activeCodes.join(','))}`} target="_blank" rel="noreferrer" aria-disabled={activeCodes.length === 0}>
            พิมพ์บาร์โค้ดทั้งหมด ({activeCodes.length})
          </a>
        </div>
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '20%' }} />
            <col style={{ width: '34%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '30%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>CODE</th>
              <th>NAME</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {stations.map((s) => (
              <tr key={s.station_code}>
                <td style={{ fontWeight: 700 }}>{s.station_code}</td>
                <td style={{ overflowWrap: 'break-word' }}>{s.name}</td>
                <td>{s.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ height: 28, padding: '0 10px' }}
                      disabled={busy}
                      onClick={() => {
                        const name = window.prompt(`ชื่อใหม่ของ Station ${s.station_code}`, s.name)
                        if (name && name.trim() && name.trim() !== s.name) run(() => send('/api/pack-stations', 'PATCH', { station_code: s.station_code, name }), setStError)
                      }}
                    >
                      Rename
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busy} onClick={() => run(() => send('/api/pack-stations', 'PATCH', { station_code: s.station_code, active: !s.active }), setStError)}>
                      {s.active ? 'Deactivate' : 'Activate'}
                    </button>
                    {s.active && (
                      <a className="btn btn-info-outline btn-sm" style={{ height: 28, padding: '0 10px' }} href={`/pack-stations/print?codes=${encodeURIComponent(s.station_code)}`} target="_blank" rel="noreferrer">
                        Print
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {stations.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                  ยังไม่มี Station — เพิ่มด้านล่าง
                </td>
              </tr>
            )}
          </tbody>
        </table>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1.6fr auto', gap: 8, alignItems: 'end' }}>
          <div className="field">
            <label className="field-label">Code</label>
            <input className="field-input" style={input} value={stCode} placeholder="PK-01" onChange={(e) => setStCode(e.target.value.toUpperCase())} />
          </div>
          <div className="field">
            <label className="field-label">Name</label>
            <input className="field-input" style={input} value={stName} placeholder="โต๊ะแพ็ก 1" onChange={(e) => setStName(e.target.value)} />
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={!stCode || !stName || busy}
            onClick={() =>
              run(() => send('/api/pack-stations', 'POST', { station_code: stCode, name: stName }), setStError, () => {
                setStCode('')
                setStName('')
              })
            }
          >
            Add
          </button>
        </div>
        {stError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{stError}</div>}
      </div>

      <div className="card">
        <div className="card-title">Pack Issue Reasons</div>
        <div className="card-subtitle" style={{ marginBottom: 12 }}>
          รายการปัญหาใน Drop down ตอนกด Completed with Short บน Handheld
        </div>
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '24%' }} />
            <col style={{ width: '36%' }} />
            <col style={{ width: '16%' }} />
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
            {reasons.map((r) => (
              <tr key={r.reason_code}>
                <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>{r.reason_code}</td>
                <td style={{ overflowWrap: 'break-word' }}>
                  {r.label_th || r.label_en}
                  {r.label_th && r.label_en !== r.label_th && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{r.label_en}</div>}
                </td>
                <td>{r.active ? <span className="badge badge-success">Active</span> : <span className="badge badge-neutral">Inactive</span>}</td>
                <td>
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    <button
                      className="btn btn-secondary btn-sm"
                      style={{ height: 28, padding: '0 10px' }}
                      disabled={busy}
                      onClick={() => {
                        const th = window.prompt(`ชื่อปัญหา (ไทย) ของ ${r.reason_code}`, r.label_th ?? r.label_en)
                        if (th && th.trim() && th.trim() !== r.label_th) run(() => send('/api/pack-issue-reasons', 'PATCH', { reason_code: r.reason_code, label_th: th }), setRsError)
                      }}
                    >
                      Rename
                    </button>
                    <button className="btn btn-secondary btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busy} onClick={() => run(() => send('/api/pack-issue-reasons', 'PATCH', { reason_code: r.reason_code, active: !r.active }), setRsError)}>
                      {r.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px dashed var(--color-border)', display: 'grid', gridTemplateColumns: '1fr 1.3fr 1.3fr auto', gap: 8, alignItems: 'end' }}>
          <div className="field">
            <label className="field-label">Code</label>
            <input className="field-input" style={input} value={rsCode} placeholder="WRONG_COLOR" onChange={(e) => setRsCode(e.target.value.toUpperCase())} />
          </div>
          <div className="field">
            <label className="field-label">ชื่อปัญหา (TH)</label>
            <input className="field-input" style={input} value={rsTh} onChange={(e) => setRsTh(e.target.value)} />
          </div>
          <div className="field">
            <label className="field-label">Label (EN)</label>
            <input className="field-input" style={input} value={rsEn} placeholder="ไม่บังคับ" onChange={(e) => setRsEn(e.target.value)} />
          </div>
          <button
            className="btn btn-primary btn-sm"
            disabled={!rsCode || !rsTh || busy}
            onClick={() =>
              run(() => send('/api/pack-issue-reasons', 'POST', { reason_code: rsCode, label_th: rsTh, label_en: rsEn }), setRsError, () => {
                setRsCode('')
                setRsTh('')
                setRsEn('')
              })
            }
          >
            Add
          </button>
        </div>
        {rsError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{rsError}</div>}
      </div>
    </div>
  )
}
