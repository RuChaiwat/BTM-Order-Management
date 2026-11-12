'use client'

import { useEffect, useRef, useState } from 'react'
import { Spinner } from '../Spinner'

interface Station {
  station_code: string
  name: string
}
interface Picker {
  picker_id: string
  name: string
}
interface Line {
  line_id: string
  sku: string
  sku_barcode: string | null
  item_description: string | null
  bin_code: string
  qty: number
}
interface Reason {
  reason_code: string
  label_en: string
  label_th: string | null
}
interface PackOrder {
  order_id: string
  order_no: string
  store_code: string
  pieces: number
  lines: Line[]
  reasons: Reason[]
}
interface Session {
  session_id: string
  started_at: string
}
interface IssueDraft {
  key: number
  lineId: string // order line_id, or NOT_IN_TO
  sku: string
  reasonCode: string
  qty: string
}

type Step = 'station' | 'picker' | 'order' | 'packing' | 'finish' | 'issue' | 'done'

const API = '/api/handheld/pack'
const NOT_IN_TO = '__not_in_to__'

/** Short beep through Web Audio -- no sound files to ship. Silently does nothing if the device
 * blocks audio. */
function beep(ok: boolean) {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    osc.frequency.value = ok ? 1200 : 300
    osc.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + (ok ? 0.12 : 0.4))
  } catch {
    /* no audio */
  }
}

function mmss(totalSeconds: number) {
  const s = Math.max(0, Math.floor(totalSeconds))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
}

/**
 * Pack Handheld: Scan Station -> Scan employee -> Scan order (timer starts) -> Scan the same order
 * again -> Completed / Completed with Short (the short is itemized later by Admin Pack Verify).
 * แจ้งปัญหา on the timer screen lists the problem items and ends the order at once (no minimum
 * time) for the Pack Supervisor to investigate. After every finished order it clears back to Scan
 * Station, so each order is always tied to the station and person who actually packed it.
 * Hardware scanners type the code and press Enter, so every step is one auto-focused input.
 */
export function PackHandheldBoard() {
  const [step, setStep] = useState<Step>('station')
  const [station, setStation] = useState<Station | null>(null)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [order, setOrder] = useState<PackOrder | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [minMinutes, setMinMinutes] = useState(5)
  const [clockOffset, setClockOffset] = useState(0) // server time - device time, ms
  const [now, setNow] = useState(Date.now())
  const [scan, setScan] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [issues, setIssues] = useState<IssueDraft[]>([])
  const [remark, setRemark] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Keep the scanner's keystrokes going into the scan box on every scanning step.
  useEffect(() => {
    if (step === 'station' || step === 'picker' || step === 'order' || step === 'packing') inputRef.current?.focus()
  }, [step, busy])

  const elapsedSec = session ? (now + clockOffset - new Date(session.started_at).getTime()) / 1000 : 0
  const minSec = minMinutes * 60
  const canFinish = elapsedSec >= minSec

  function fail(message: string) {
    setError(message)
    setNotice(null)
    beep(false)
  }

  function resetAll(message?: string) {
    setStation(null)
    setPicker(null)
    setOrder(null)
    setSession(null)
    setIssues([])
    setRemark('')
    setScan('')
    setError(null)
    setNotice(message ?? null)
    setStep('station')
  }

  async function call(method: 'GET' | 'POST', payload?: Record<string, unknown>, query?: string) {
    const res = await fetch(method === 'GET' ? `${API}?${query}` : API, {
      method,
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(payload) : undefined,
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
    if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`)
    return body
  }

  async function onScan(e: React.FormEvent) {
    e.preventDefault()
    const value = scan.trim()
    setScan('')
    if (!value || busy) return
    setError(null)

    if (step === 'packing') {
      if (!order || value.toUpperCase() !== order.order_no.toUpperCase()) return fail(`เลข order ไม่ตรงกับงานที่กำลังแพ็ก (${order?.order_no}) · Scan the same order to finish`)
      if (!canFinish) return fail(`ยังไม่ครบเวลาขั้นต่ำ ${minMinutes} นาที — รออีก ${mmss(minSec - elapsedSec)}`)
      beep(true)
      setNotice(null)
      setStep('finish')
      return
    }

    setBusy(true)
    try {
      if (step === 'station') {
        const body = await call('GET', undefined, `station=${encodeURIComponent(value)}`)
        setStation(body.station)
        setNotice(null)
        setStep('picker')
      } else if (step === 'picker' && station) {
        const body = await call('GET', undefined, `station=${encodeURIComponent(station.station_code)}&picker=${encodeURIComponent(value)}`)
        setPicker(body.picker)
        setStep('order')
      } else if (step === 'order' && station && picker) {
        const body = await call('POST', { action: 'scan_order', station: station.station_code, picker: picker.picker_id, order_no: value })
        setOrder(body.order)
        setSession(body.session)
        setMinMinutes(body.min_minutes)
        setClockOffset(new Date(body.server_now).getTime() - Date.now())
        setNow(Date.now())
        setNotice(body.resumed ? 'กลับมาทำงานที่เปิดค้างไว้ต่อ · Resumed your open order' : null)
        setStep('packing')
      }
      beep(true)
    } catch (err) {
      fail((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function submitFinish(result: 'completed' | 'completed_short' | 'issue') {
    if (!station || !picker || !session) return
    let issueLines: { line_id: string | null; sku?: string; reason_code: string; qty: number }[] = []
    if (result === 'issue') {
      if (issues.length === 0) return fail('เพิ่มสินค้าที่มีปัญหาอย่างน้อย 1 รายการ')
      for (const [i, d] of issues.entries()) {
        const qty = Number(d.qty)
        if (!d.lineId) return fail(`รายการที่ ${i + 1}: เลือกสินค้า`)
        if (d.lineId === NOT_IN_TO && !d.sku.trim()) return fail(`รายการที่ ${i + 1}: scan หรือพิมพ์บาร์โค้ดสินค้าที่ไม่อยู่ใน TO`)
        if (!d.reasonCode) return fail(`รายการที่ ${i + 1}: เลือกปัญหา`)
        if (!Number.isInteger(qty) || qty < 1) return fail(`รายการที่ ${i + 1}: จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`)
      }
      issueLines = issues.map((d) => (d.lineId === NOT_IN_TO ? { line_id: null, sku: d.sku.trim(), reason_code: d.reasonCode, qty: Number(d.qty) } : { line_id: d.lineId, reason_code: d.reasonCode, qty: Number(d.qty) }))
    }
    setBusy(true)
    setError(null)
    try {
      await call('POST', { action: 'finish', station: station.station_code, picker: picker.picker_id, session_id: session.session_id, result, remark, issue_lines: issueLines })
      beep(true)
      const doneMsg =
        result === 'completed'
          ? `✓ ${order?.order_no} แพ็กเสร็จ (${mmss(elapsedSec)})`
          : result === 'completed_short'
            ? `✓ ${order?.order_no} ปิดงานแบบ Completed with Short (${mmss(elapsedSec)}) · Admin จะระบุรายการที่ขาด`
            : `⚠ ${order?.order_no} แจ้งปัญหาให้ Supervisor แล้ว`
      resetAll(doneMsg)
    } catch (err) {
      fail((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function addIssue() {
    setIssues((prev) => [...prev, { key: Date.now() + prev.length, lineId: '', sku: '', reasonCode: '', qty: '1' }])
  }
  function updateIssue(key: number, patch: Partial<IssueDraft>) {
    setIssues((prev) => prev.map((d) => (d.key === key ? { ...d, ...patch } : d)))
  }

  const stepNo = step === 'station' ? 1 : step === 'picker' ? 2 : 3
  const prompt =
    step === 'station'
      ? { title: 'Scan Station', th: 'สแกนบาร์โค้ด Station ที่ทำงาน' }
      : step === 'picker'
        ? { title: 'Scan รหัสพนักงาน', th: 'สแกนบัตรพนักงานของคุณ' }
        : step === 'order'
          ? { title: 'Scan Order', th: 'สแกนเลข order เพื่อเริ่มจับเวลา' }
          : { title: 'Scan order เดิมเพื่อจบงาน', th: canFinish ? 'scan เลข order นี้อีกครั้งเพื่อปิดงาน' : `ปิดงานได้เมื่อครบ ${minMinutes} นาที` }

  const big: React.CSSProperties = { fontSize: 22, fontWeight: 700 }
  const scanBox: React.CSSProperties = { width: '100%', height: 52, fontSize: 20, padding: '0 14px', border: '2px solid var(--color-info)', borderRadius: 10, fontFamily: 'inherit' }

  return (
    <div className="page-body" style={{ maxWidth: 640, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {notice && <div style={{ background: 'var(--color-success-bg)', color: 'var(--color-success-dark)', border: '1px solid var(--color-success-border)', borderRadius: 10, padding: '12px 14px', fontSize: 16, fontWeight: 600 }}>{notice}</div>}
      {error && <div style={{ background: 'var(--color-danger-bg)', color: 'var(--color-danger-dark)', border: '1px solid var(--color-danger-border)', borderRadius: 10, padding: '12px 14px', fontSize: 16, fontWeight: 600 }}>{error}</div>}

      {(station || picker) && (
        <div className="card" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 14, padding: '10px 14px' }}>
          <span>
            Station: <b>{station?.station_code ?? '—'}</b> {station?.name && <span style={{ color: 'var(--color-text-secondary)' }}>· {station.name}</span>}
          </span>
          <span>
            พนักงาน: <b>{picker ? `${picker.picker_id} ${picker.name}` : '—'}</b>
          </span>
        </div>
      )}

      {(step === 'station' || step === 'picker' || step === 'order') && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>ขั้นที่ {stepNo}/3</div>
          <div style={big}>{prompt.title}</div>
          <div style={{ fontSize: 14, color: 'var(--color-text-secondary)' }}>{prompt.th}</div>
          <form onSubmit={onScan}>
            <input ref={inputRef} value={scan} onChange={(e) => setScan(e.target.value)} style={scanBox} autoComplete="off" autoCapitalize="characters" disabled={busy} placeholder="scan หรือพิมพ์แล้วกด Enter" />
          </form>
          {busy && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', color: 'var(--color-text-secondary)' }}>
              <Spinner /> กำลังตรวจสอบ…
            </div>
          )}
          {step !== 'station' && (
            <button type="button" className="btn btn-secondary" onClick={() => resetAll()} disabled={busy}>
              เริ่มใหม่ (scan Station ใหม่)
            </button>
          )}
        </div>
      )}

      {(step === 'packing' || step === 'finish' || step === 'issue') && order && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: canFinish ? 'var(--color-success-border)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={big}>{order.order_no}</span>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{order.store_code}</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 44, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: canFinish ? 'var(--color-success)' : 'var(--color-text)' }}>{mmss(elapsedSec)}</div>
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {canFinish ? 'ครบเวลาขั้นต่ำแล้ว ปิดงานได้' : `ขั้นต่ำ ${mmss(minSec)} · ยังปิดงานไม่ได้`} · {order.lines.length} SKU · {order.pieces.toLocaleString()} ชิ้น
          </div>

          {step === 'packing' && (
            <>
              <div style={{ fontWeight: 600 }}>{prompt.title}</div>
              <form onSubmit={onScan}>
                <input ref={inputRef} value={scan} onChange={(e) => setScan(e.target.value)} style={{ ...scanBox, borderColor: canFinish ? 'var(--color-success)' : 'var(--color-border)' }} autoComplete="off" placeholder={prompt.th} />
              </form>
              <button
                type="button"
                className="btn btn-danger-outline"
                style={{ height: 50, fontSize: 16, fontWeight: 700 }}
                disabled={busy}
                onClick={() => {
                  if (issues.length === 0) addIssue()
                  setError(null)
                  setStep('issue')
                }}
              >
                ⚠ แจ้งปัญหา
              </button>
            </>
          )}

          {step === 'finish' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <button className="btn btn-success" style={{ height: 56, fontSize: 18 }} disabled={busy} onClick={() => submitFinish('completed')}>
                {busy && <Spinner />} Completed
              </button>
              <button
                className="btn btn-warning"
                style={{ height: 56, fontSize: 18 }}
                disabled={busy}
                onClick={() => submitFinish('completed_short')}
              >
                {busy && <Spinner />} Completed with Short
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setStep('packing')}>
                ย้อนกลับ (ยังไม่ปิดงาน)
              </button>
            </div>
          )}

          {step === 'issue' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontWeight: 700, fontSize: 16 }}>แจ้งปัญหา · ระบุสินค้าที่มีปัญหา</div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>ส่งแล้วจะหยุดเวลาและจบงาน order นี้ทันที Supervisor จะมาตรวจสอบสินค้า</div>
              {issues.map((d, i) => (
                <div key={d.key} style={{ border: '1px solid var(--color-border)', borderRadius: 10, padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, fontWeight: 600 }}>
                    รายการที่ {i + 1}
                    {issues.length > 1 && (
                      <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setIssues((prev) => prev.filter((x) => x.key !== d.key))}>
                        ลบ
                      </button>
                    )}
                  </div>
                  <select className="field-input" style={{ height: 44, fontSize: 15, border: '1px solid var(--color-border)' }} value={d.lineId} onChange={(e) => updateIssue(d.key, { lineId: e.target.value })}>
                    <option value="">— เลือกสินค้า —</option>
                    {order.lines.map((l) => (
                      <option key={l.line_id} value={l.line_id}>
                        {l.sku} · {l.item_description ?? ''} ({l.qty})
                      </option>
                    ))}
                    <option value={NOT_IN_TO}>สินค้าไม่อยู่ใน TO (scan/พิมพ์บาร์โค้ด)</option>
                  </select>
                  {d.lineId === NOT_IN_TO && (
                    <input className="field-input" style={{ height: 44, fontSize: 15, border: '1px solid var(--color-border)' }} placeholder="บาร์โค้ด / SKU" value={d.sku} onChange={(e) => updateIssue(d.key, { sku: e.target.value })} />
                  )}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 100px', gap: 8 }}>
                    <select className="field-input" style={{ height: 44, fontSize: 15, border: '1px solid var(--color-border)' }} value={d.reasonCode} onChange={(e) => updateIssue(d.key, { reasonCode: e.target.value })}>
                      <option value="">— เลือกปัญหา —</option>
                      {order.reasons.map((r) => (
                        <option key={r.reason_code} value={r.reason_code}>
                          {r.label_th || r.label_en}
                        </option>
                      ))}
                    </select>
                    <input
                      className="field-input"
                      type="number"
                      inputMode="numeric"
                      min={1}
                      step={1}
                      style={{ height: 44, fontSize: 15, border: '1px solid var(--color-border)' }}
                      value={d.qty}
                      onChange={(e) => updateIssue(d.key, { qty: e.target.value })}
                      aria-label="จำนวนที่มีปัญหา"
                    />
                  </div>
                </div>
              ))}
              <button type="button" className="btn btn-secondary" onClick={addIssue} disabled={busy}>
                + เพิ่มรายการ
              </button>
              <textarea
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                placeholder="หมายเหตุ (ไม่บังคับ)"
                style={{ width: '100%', minHeight: 60, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }}
              />
              <button className="btn btn-danger" style={{ height: 52, fontSize: 17 }} disabled={busy} onClick={() => submitFinish('issue')}>
                {busy && <Spinner />} ส่งเรื่องแจ้งปัญหา &amp; หยุดเวลา
              </button>
              <button className="btn btn-secondary" disabled={busy} onClick={() => setStep('packing')}>
                ย้อนกลับ (แพ็กต่อ)
              </button>
            </div>
          )}

          <details style={{ fontSize: 13 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--color-text-secondary)' }}>รายการสินค้าใน order ({order.lines.length})</summary>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%', marginTop: 6 }}>
              <colgroup>
                <col style={{ width: '70%' }} />
                <col style={{ width: '30%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>QTY</th>
                </tr>
              </thead>
              <tbody>
                {order.lines.map((l) => (
                  <tr key={l.line_id}>
                    <td style={{ overflowWrap: 'break-word' }}>
                      {l.sku}
                      {l.item_description && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{l.item_description}</div>}
                    </td>
                    <td style={{ fontWeight: 700 }}>{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </div>
      )}
    </div>
  )
}
