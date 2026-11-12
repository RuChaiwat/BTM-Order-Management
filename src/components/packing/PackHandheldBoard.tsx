'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
  /** verified picked qty (V) */
  qty: number
  /** ordered qty (O) */
  ordered_qty: number
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
/** One reported problem -- one per barcode (choosing the same barcode again edits it). */
interface IssueDraft {
  /** order line_id, or null for an item that is not in the TO */
  lineId: string | null
  barcode: string
  description: string | null
  reasonCode: string
  qty: number
  remark: string
}
/** The problem popup being filled in. */
interface IssueForm {
  lineId: string | null
  barcode: string
  description: string | null
  ordered: number | null
  verified: number | null
  reasonCode: string
  qty: string
  remark: string
  editing: boolean
}

type Step = 'station' | 'picker' | 'order' | 'packing' | 'finish' | 'done'

const API = '/api/handheld/pack'
const NOT_IN_TO_REASON = 'NOT_IN_TO'
const draftKey = (sessionId: string) => `btm.pack.issues.${sessionId}`
const issueKey = (d: { lineId: string | null; barcode: string }) => d.lineId ?? `x:${d.barcode.toUpperCase()}`

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
 * Problems are reported by tapping a line of the order (barcode filled in; one problem + qty +
 * optional comment per barcode) or "+ สินค้าไม่อยู่ใน TO". While any problem is listed the finish
 * scan is locked and the only way out is ส่งแจ้งปัญหา & หยุดเวลา, which ends the order at once (no
 * minimum time) for the Pack Supervisor to investigate. After every finished order it clears back to Scan
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
  const [form, setForm] = useState<IssueForm | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Unsent problem lines survive a page refresh on this device (keyed by the pack session).
  useEffect(() => {
    if (!session) return
    try {
      const raw = localStorage.getItem(draftKey(session.session_id))
      setIssues(raw ? (JSON.parse(raw) as IssueDraft[]) : [])
    } catch {
      setIssues([])
    }
  }, [session])
  useEffect(() => {
    if (!session) return
    try {
      if (issues.length) localStorage.setItem(draftKey(session.session_id), JSON.stringify(issues))
      else localStorage.removeItem(draftKey(session.session_id))
    } catch {
      /* storage blocked */
    }
  }, [issues, session])

  // Lines sorted by barcode; lines without a barcode (shown as SKU) go last.
  const sortedLines = useMemo(
    () =>
      [...(order?.lines ?? [])].sort((a, b) => {
        if (!a.sku_barcode !== !b.sku_barcode) return a.sku_barcode ? -1 : 1
        return (a.sku_barcode ?? a.sku).localeCompare(b.sku_barcode ?? b.sku, undefined, { numeric: true })
      }),
    [order],
  )
  const issueByKey = useMemo(() => new Map(issues.map((d) => [issueKey(d), d])), [issues])
  const reasonLabel = (code: string) => {
    const r = order?.reasons.find((x) => x.reason_code === code)
    return r ? r.label_th || r.label_en : code
  }

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Keep the scanner's keystrokes going into the scan box on every scanning step.
  useEffect(() => {
    if (form) return
    if (step === 'station' || step === 'picker' || step === 'order' || step === 'packing') inputRef.current?.focus()
  }, [step, busy, form, issues.length])

  const elapsedSec = session ? (now + clockOffset - new Date(session.started_at).getTime()) / 1000 : 0
  const minSec = minMinutes * 60
  const canFinish = elapsedSec >= minSec

  function fail(message: string) {
    setError(message)
    setNotice(null)
    beep(false)
  }

  function resetAll(message?: string) {
    if (session) {
      try {
        localStorage.removeItem(draftKey(session.session_id))
      } catch {
        /* storage blocked */
      }
    }
    setForm(null)
    setStation(null)
    setPicker(null)
    setOrder(null)
    setSession(null)
    setIssues([])
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
      if (issues.length > 0) return fail('มีรายการแจ้งปัญหาอยู่ — ลบรายการปัญหาให้หมดก่อน จึงจะ scan ปิดงานได้')
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
    if (result === 'issue' && issues.length === 0) return fail('กดที่รายการสินค้าเพื่อแจ้งปัญหาอย่างน้อย 1 รายการ')
    if (result !== 'issue' && issues.length > 0) return fail('มีรายการแจ้งปัญหาอยู่ — ลบรายการปัญหาให้หมดก่อนปิดงาน')
    const issueLines = result === 'issue' ? issues.map((d) => ({ line_id: d.lineId, barcode: d.lineId ? undefined : d.barcode, reason_code: d.reasonCode, qty: d.qty, remark: d.remark.trim() || null })) : []
    setBusy(true)
    setError(null)
    try {
      await call('POST', { action: 'finish', station: station.station_code, picker: picker.picker_id, session_id: session.session_id, result, issue_lines: issueLines })
      beep(true)
      const doneMsg =
        result === 'completed'
          ? `✓ ${order?.order_no} แพ็กเสร็จ (${mmss(elapsedSec)})`
          : result === 'completed_short'
            ? `✓ ${order?.order_no} ปิดงานแบบ Completed with Short (${mmss(elapsedSec)}) · Admin จะระบุรายการที่ขาด`
            : `⚠ ${order?.order_no} แจ้งปัญหาให้ Supervisor แล้ว (${issues.length} รายการ)`
      resetAll(doneMsg)
    } catch (err) {
      fail((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  /** Tap a line of the order -> problem popup with its barcode filled in (edits it if already listed). */
  function openLine(l: Line) {
    if (step !== 'packing' || busy) return
    const existing = issueByKey.get(l.line_id)
    setFormError(null)
    setForm({
      lineId: l.line_id,
      barcode: l.sku_barcode || `SKU ${l.sku}`,
      description: l.item_description,
      ordered: l.ordered_qty,
      verified: l.qty,
      reasonCode: existing?.reasonCode ?? '',
      qty: String(existing?.qty ?? 1),
      remark: existing?.remark ?? '',
      editing: !!existing,
    })
  }
  function openNotInTo(existing?: IssueDraft) {
    if (step !== 'packing' || busy) return
    setFormError(null)
    const fixed = order?.reasons.some((r) => r.reason_code === NOT_IN_TO_REASON) ? NOT_IN_TO_REASON : ''
    setForm({ lineId: null, barcode: existing?.barcode ?? '', description: null, ordered: null, verified: null, reasonCode: existing?.reasonCode ?? fixed, qty: String(existing?.qty ?? 1), remark: existing?.remark ?? '', editing: !!existing })
  }
  function openDraft(d: IssueDraft) {
    const line = d.lineId ? order?.lines.find((l) => l.line_id === d.lineId) : undefined
    if (line) openLine(line)
    else openNotInTo(d)
  }

  function saveForm() {
    if (!form || !order) return
    const barcode = form.barcode.trim()
    const qty = Number(form.qty)
    if (!form.lineId) {
      if (!barcode) return setFormError('scan บาร์โค้ดของสินค้าที่ไม่อยู่ใน TO')
      const inTo = order.lines.find((l) => (l.sku_barcode ?? '').toUpperCase() === barcode.toUpperCase())
      if (inTo) return setFormError(`บาร์โค้ด ${barcode} อยู่ใน TO — ปิดหน้านี้แล้วกดที่รายการนั้นแทน`)
    }
    if (!form.reasonCode) return setFormError('เลือกปัญหา')
    // No upper limit -- สินค้าเกิน can be far more than was verified.
    if (!Number.isInteger(qty) || qty < 1) return setFormError('จำนวนต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป')
    const draft: IssueDraft = { lineId: form.lineId, barcode, description: form.description, reasonCode: form.reasonCode, qty, remark: form.remark.trim() }
    const key = issueKey(draft)
    setIssues((prev) => {
      const i = prev.findIndex((d) => issueKey(d) === key)
      if (i < 0) return [...prev, draft]
      const next = [...prev]
      next[i] = draft
      return next
    })
    setForm(null)
    setError(null)
  }

  function removeIssue(key: string) {
    setIssues((prev) => prev.filter((d) => issueKey(d) !== key))
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

      {(step === 'packing' || step === 'finish') && order && (
        <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, borderColor: canFinish ? 'var(--color-success-border)' : undefined }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
            <span style={big}>{order.order_no}</span>
            <span style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>{order.store_code}</span>
          </div>
          <div style={{ textAlign: 'center', fontSize: 44, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: canFinish ? 'var(--color-success)' : 'var(--color-text)' }}>{mmss(elapsedSec)}</div>
          <div style={{ textAlign: 'center', fontSize: 13, color: 'var(--color-text-secondary)' }}>
            {canFinish ? 'ครบเวลาขั้นต่ำแล้ว ปิดงานได้' : `ขั้นต่ำ ${mmss(minSec)} · ยังปิดงานไม่ได้`} · {order.lines.length} รายการ · {order.pieces.toLocaleString()} ชิ้น
          </div>

          {step === 'packing' && issues.length === 0 && (
            <>
              <div style={{ fontWeight: 600 }}>{prompt.title}</div>
              <form onSubmit={onScan}>
                <input ref={inputRef} value={scan} onChange={(e) => setScan(e.target.value)} style={{ ...scanBox, borderColor: canFinish ? 'var(--color-success)' : 'var(--color-border)' }} autoComplete="off" placeholder={prompt.th} />
              </form>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>พบปัญหา? กดที่รายการสินค้าด้านล่างเพื่อแจ้ง</div>
            </>
          )}

          {step === 'packing' && issues.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, border: '1px solid var(--color-danger-border)', background: 'var(--color-danger-bg)', borderRadius: 10, padding: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--color-danger-dark)' }}>รายการแจ้งปัญหา ({issues.length})</div>
              {issues.map((d) => (
                <div key={issueKey(d)} style={{ display: 'flex', gap: 8, alignItems: 'center', background: 'var(--color-surface, #fff)', border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px' }}>
                  <button type="button" onClick={() => openDraft(d)} disabled={busy} style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                    <div style={{ fontWeight: 700, overflowWrap: 'break-word' }}>{d.barcode}</div>
                    <div style={{ fontSize: 13 }}>
                      {reasonLabel(d.reasonCode)} · <b>{d.qty}</b> ชิ้น{!d.lineId && <span style={{ color: 'var(--color-text-secondary)' }}> · ไม่อยู่ใน TO</span>}
                    </div>
                    {d.remark && <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', overflowWrap: 'break-word' }}>“{d.remark}”</div>}
                  </button>
                  <button type="button" className="btn btn-danger-outline btn-sm" disabled={busy} onClick={() => removeIssue(issueKey(d))}>
                    ลบ
                  </button>
                </div>
              ))}
              <div style={{ fontSize: 12.5, color: 'var(--color-danger-dark)' }}>ช่อง scan ปิดงานถูกล็อกไว้ — ถ้าไม่มีปัญหาจริง ให้ลบรายการปัญหาให้หมด</div>
              <button className="btn btn-danger" style={{ height: 52, fontSize: 17 }} disabled={busy} onClick={() => submitFinish('issue')}>
                {busy && <Spinner />} ส่งแจ้งปัญหา &amp; หยุดเวลา
              </button>
            </div>
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

          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 4 }}>รายการสินค้าใน order ({order.lines.length})</div>
          <table className="table" style={{ tableLayout: 'fixed', width: '100%', fontSize: 14 }}>
            <colgroup>
              <col style={{ width: '72%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>BARCODE</th>
                <th title="Order QTY / Verify QTY">
                  QTY <span style={{ fontWeight: 400, fontSize: 11 }}>(O/V)</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {sortedLines.map((l) => {
                const flagged = issueByKey.get(l.line_id)
                const short = l.qty < l.ordered_qty
                return (
                  <tr key={l.line_id} onClick={() => openLine(l)} style={{ cursor: step === 'packing' ? 'pointer' : undefined, background: flagged ? 'var(--color-danger-bg)' : undefined }}>
                    <td style={{ overflowWrap: 'break-word' }}>
                      <span style={{ fontWeight: 600 }}>{l.sku_barcode || `SKU ${l.sku}`}</span>
                      {flagged && (
                        <span style={{ color: 'var(--color-danger-dark)', fontSize: 12 }}>
                          {' '}
                          ⚠ {reasonLabel(flagged.reasonCode)} {flagged.qty}
                        </span>
                      )}
                      {l.item_description && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{l.item_description}</div>}
                    </td>
                    <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: short ? 'var(--color-warning-dark)' : undefined }}>
                      {l.ordered_qty}/{l.qty}
                    </td>
                  </tr>
                )
              })}
              {issues
                .filter((d) => !d.lineId)
                .map((d) => (
                  <tr key={issueKey(d)} onClick={() => openNotInTo(d)} style={{ cursor: step === 'packing' ? 'pointer' : undefined, background: 'var(--color-danger-bg)' }}>
                    <td style={{ overflowWrap: 'break-word' }}>
                      <span style={{ fontWeight: 600 }}>{d.barcode}</span>
                      <span style={{ color: 'var(--color-danger-dark)', fontSize: 12 }}>
                        {' '}
                        ⚠ {reasonLabel(d.reasonCode)} {d.qty}
                      </span>
                      <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>ไม่อยู่ใน TO</div>
                    </td>
                    <td style={{ fontWeight: 700 }}>0/0</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {step === 'packing' && (
            <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => openNotInTo()}>
              + สินค้าไม่อยู่ใน TO
            </button>
          )}
        </div>
      )}

      {form && order && (
        <div role="dialog" aria-modal="true" onClick={() => setForm(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', zIndex: 1000, padding: 12 }}>
          <div className="card" onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 560, maxHeight: '90vh', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ fontWeight: 700, fontSize: 18 }}>{form.lineId ? (form.editing ? 'แก้ไขปัญหา' : 'แจ้งปัญหา') : 'สินค้าไม่อยู่ใน TO'}</div>
            {form.lineId ? (
              <div>
                <div style={{ fontSize: 20, fontWeight: 700, overflowWrap: 'break-word' }}>{form.barcode}</div>
                {form.description && <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{form.description}</div>}
                <div style={{ fontSize: 13, marginTop: 2 }}>
                  QTY (O/V):{' '}
                  <b>
                    {form.ordered}/{form.verified}
                  </b>
                </div>
              </div>
            ) : (
              <input
                autoFocus
                className="field-input"
                style={{ height: 48, fontSize: 18, border: '2px solid var(--color-info)' }}
                placeholder="scan บาร์โค้ดสินค้า"
                autoComplete="off"
                value={form.barcode}
                onChange={(e) => setForm({ ...form, barcode: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.preventDefault()
                }}
              />
            )}
            {!form.lineId && form.reasonCode === NOT_IN_TO_REASON ? (
              <div style={{ fontSize: 14 }}>
                ปัญหา: <b>{reasonLabel(NOT_IN_TO_REASON)}</b>
              </div>
            ) : (
              <select className="field-input" style={{ height: 48, fontSize: 16, border: '1px solid var(--color-border)' }} value={form.reasonCode} onChange={(e) => setForm({ ...form, reasonCode: e.target.value })}>
                <option value="">— เลือกปัญหา —</option>
                {order.reasons
                  .filter((r) => !form.lineId || r.reason_code !== NOT_IN_TO_REASON)
                  .map((r) => (
                    <option key={r.reason_code} value={r.reason_code}>
                      {r.label_th || r.label_en}
                    </option>
                  ))}
              </select>
            )}
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
              จำนวน
              <input className="field-input" type="number" inputMode="numeric" min={1} step={1} style={{ height: 48, fontSize: 18, width: 120, border: '1px solid var(--color-border)' }} value={form.qty} onChange={(e) => setForm({ ...form, qty: e.target.value })} />
              ชิ้น
            </label>
            <textarea
              value={form.remark}
              onChange={(e) => setForm({ ...form, remark: e.target.value })}
              placeholder="Comment (ไม่บังคับ)"
              maxLength={500}
              style={{ width: '100%', minHeight: 64, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 15, fontFamily: 'inherit' }}
            />
            {formError && <div style={{ color: 'var(--color-danger-dark)', fontWeight: 600, fontSize: 14 }}>{formError}</div>}
            <button className="btn btn-danger" style={{ height: 50, fontSize: 17 }} onClick={saveForm}>
              ยืนยัน
            </button>
            <button className="btn btn-secondary" onClick={() => setForm(null)}>
              ยกเลิก
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
