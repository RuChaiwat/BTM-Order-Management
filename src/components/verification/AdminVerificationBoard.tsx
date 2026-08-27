'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'

interface QueueOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  pickerName: string
  waitMinutes: number
  completion?: { actual_pieces: number; result: string; remark: string | null; picker_completed_time: string } | null
}

interface ActiveOrder {
  order_id: string
  order_no: string
  planned_pieces: number
  pickerName: string
}

interface Reason {
  reason_code: string
  label_en: string
}

export function AdminVerificationBoard({ queue, active, shortPickReasons }: { queue: QueueOrder[]; active: ActiveOrder[]; shortPickReasons: Reason[] }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(queue[0]?.order_id ?? '')
  const [showReject, setShowReject] = useState(false)
  const [reason, setReason] = useState(shortPickReasons[0]?.reason_code ?? '')
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = queue.find((o) => o.order_id === selectedId) ?? queue[0]

  async function verify(decision: 'final_close' | 'reject') {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/admin-verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: selected.order_id, decision, reject_reason: decision === 'reject' ? remark || 'Rejected for correction' : undefined }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    setShowReject(false)
    setRemark('')
    router.refresh()
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 440px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <QuickPickerActions active={active} shortPickReasons={shortPickReasons} onDone={() => router.refresh()} />

          <div className="card" style={{ minHeight: 0 }}>
            <div className="card-title">Verification queue</div>
            <div className="card-subtitle" style={{ marginBottom: 12 }}>
              sorted by wait time
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>PICKER</th>
                  <th>PLAN / ACTUAL</th>
                  <th>RESULT</th>
                  <th>WAIT</th>
                </tr>
              </thead>
              <tbody>
                {queue
                  .slice()
                  .sort((a, b) => b.waitMinutes - a.waitMinutes)
                  .map((o) => (
                    <tr key={o.order_id} className={o.order_id === selectedId ? 'row-flag' : undefined} onClick={() => setSelectedId(o.order_id)} style={{ cursor: 'pointer' }}>
                      <td className="link">{o.order_no}</td>
                      <td>{o.pickerName}</td>
                      <td>
                        {o.planned_pieces} / {o.completion?.actual_pieces ?? '—'}
                      </td>
                      <td>
                        <span className={`badge badge-${o.completion?.result === '100_percent' ? 'success' : 'warning'}`}>
                          {o.completion?.result === '100_percent' ? '100%' : `Short ${o.planned_pieces - (o.completion?.actual_pieces ?? 0)}`}
                        </span>
                      </td>
                      <td>{o.waitMinutes}m</td>
                    </tr>
                  ))}
                {queue.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      Nothing waiting on verification.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card" style={{ minHeight: 0 }}>
          {selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 700 }}>{selected.order_no}</div>
                  <div style={{ fontSize: 11.5, color: '#6B7280' }}>{selected.store_code}</div>
                </div>
                <span className={`badge badge-${selected.completion?.result === '100_percent' ? 'success' : 'warning'}`} style={{ marginLeft: 'auto' }}>
                  {selected.completion?.result === '100_percent' ? 'Picker Completed 100%' : 'Picker Completed Short'}
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, margin: '14px 0 16px', fontSize: 12.5 }}>
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>Plan / Actual</span>
                  <div style={{ fontWeight: 700 }}>
                    {selected.planned_pieces} / {selected.completion?.actual_pieces}
                  </div>
                </div>
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>Wait time</span>
                  <div style={{ fontWeight: 700 }}>{selected.waitMinutes}m</div>
                </div>
              </div>
              {selected.completion?.remark && (
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '12px 14px', fontSize: 12, lineHeight: 1.6, marginBottom: 16 }}>
                  <span style={{ color: '#6B7280' }}>Picker remark</span>
                  <div>{selected.completion.remark}</div>
                </div>
              )}
              {error && <div style={{ fontSize: 12, color: 'var(--color-danger)', marginBottom: 12 }}>{error}</div>}
              <div className="mt-auto" style={{ paddingTop: 16, display: 'flex', gap: 10 }}>
                <button className="btn btn-success" style={{ flex: 1 }} disabled={busy} onClick={() => verify('final_close')}>
                  Final Close
                </button>
                <button className="btn btn-danger-outline" style={{ flex: 1, fontWeight: 700 }} onClick={() => setShowReject(true)}>
                  Reject for correction
                </button>
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-secondary)' }}>Select an order from the queue.</span>
          )}
        </div>
      </div>

      {showReject && selected && (
        <Modal title={`Reject ${selected.order_no} for correction?`} subtitle="ส่งกลับเพื่อแก้ไข">
          <div className="modal-body" style={{ paddingTop: 14 }}>
            The order returns to <strong>Correction in Progress</strong>. A reason is required and written to the audit trail.
          </div>
          <div style={{ padding: '16px 24px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              Reason <span style={{ color: '#DC2626' }}>*</span>
            </div>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="e.g. Short quantity not verified at bin"
              style={{ width: '100%', minHeight: 76, border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit' }}
            />
          </div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" onClick={() => setShowReject(false)}>
              Cancel
            </button>
            <button className="modal-footer-btn btn-danger" style={{ minWidth: 170, border: 0 }} disabled={!remark || busy} onClick={() => verify('reject')}>
              Reject &amp; notify picker
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}

function QuickPickerActions({ active, shortPickReasons, onDone }: { active: ActiveOrder[]; shortPickReasons: Reason[]; onDone: () => void }) {
  const [orderId, setOrderId] = useState(active[0]?.order_id ?? '')
  const [actualPieces, setActualPieces] = useState('')
  const [busy, setBusy] = useState(false)
  const order = useMemo(() => active.find((o) => o.order_id === orderId), [active, orderId])

  async function complete() {
    if (!order) return
    setBusy(true)
    const actual = Number(actualPieces || order.planned_pieces)
    await fetch('/api/picker-completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.order_id,
        actual_pieces: actual,
        short_reason_code: actual < order.planned_pieces ? shortPickReasons[0]?.reason_code : undefined,
      }),
    })
    setBusy(false)
    setActualPieces('')
    onDone()
  }

  if (active.length === 0) return null

  return (
    <div className="card">
      <div className="card-title">Picker Monitor (quick action)</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        No dedicated PDA screen in this build yet — use this to mark an in-progress order as picker-completed for testing
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'end' }}>
        <select className="control" value={orderId} onChange={(e) => setOrderId(e.target.value)}>
          {active.map((o) => (
            <option key={o.order_id} value={o.order_id}>
              {o.order_no} · {o.pickerName} · plan {o.planned_pieces}
            </option>
          ))}
        </select>
        <input className="control" placeholder={`Actual pcs (default ${order?.planned_pieces ?? ''})`} value={actualPieces} onChange={(e) => setActualPieces(e.target.value)} style={{ width: 180 }} />
        <button className="btn btn-primary btn-sm" disabled={busy} onClick={complete}>
          Mark completed
        </button>
      </div>
    </div>
  )
}
