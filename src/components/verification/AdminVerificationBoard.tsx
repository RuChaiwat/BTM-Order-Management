'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'

interface ShortLine {
  line_id: string
  ordered_qty: number
  picked_qty: number
  short_reason_code: string | null
  remark: string | null
  sku: string
  item_description: string | null
}

interface QueueOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  pickerName: string
  waitMinutes: number
  shortLines: ShortLine[]
  completion?: { actual_pieces: number; result: string; remark: string | null; picker_completed_time: string } | null
}

/** §12.3 Admin Verification — office-only screen (picker is at the work site; this is the admin
 * confirming the pick in the WMS). Queue is sorted by the order in which pickers finished
 * (oldest first). Admin can confirm one order, or Confirm All to close out the whole queue. */
export function AdminVerificationBoard({ queue }: { queue: QueueOrder[] }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(queue[0]?.order_id ?? '')
  const [showReject, setShowReject] = useState(false)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [remark, setRemark] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selected = queue.find((o) => o.order_id === selectedId) ?? queue[0]

  async function postDecision(orderId: string, decision: 'final_close' | 'reject', rejectReason?: string) {
    const res = await fetch('/api/admin-verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, decision, reject_reason: rejectReason }),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error)
    }
  }

  async function verify(decision: 'final_close' | 'reject') {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      await postDecision(selected.order_id, decision, decision === 'reject' ? remark || 'Rejected for correction' : undefined)
      setShowReject(false)
      setRemark('')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmAll() {
    setBusy(true)
    setError(null)
    const failures: string[] = []
    for (const o of queue) {
      try {
        await postDecision(o.order_id, 'final_close')
      } catch (e) {
        failures.push(`${o.order_no}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    setShowConfirmAll(false)
    if (failures.length > 0) setError(failures.join('; '))
    router.refresh()
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 440px', gap: 16 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <div className="card" style={{ minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span className="card-title">Verification queue</span>
              <span className="card-subtitle">sorted by picker completion time — oldest first</span>
              <button className="btn btn-success btn-sm" style={{ marginLeft: 'auto' }} disabled={queue.length === 0 || busy} onClick={() => setShowConfirmAll(true)}>
                Confirm All ({queue.length})
              </button>
            </div>
            <table className="table" style={{ marginTop: 8 }}>
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
                {queue.map((o) => (
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
              {selected.shortLines.length > 0 && (
                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Short-picked items</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {selected.shortLines.map((l) => (
                      <div key={l.line_id} style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 10px', fontSize: 12 }}>
                        <strong>{l.sku}</strong> — {l.picked_qty} / {l.ordered_qty}
                        {l.short_reason_code && <span style={{ color: '#6B7280' }}> · {l.short_reason_code}</span>}
                        {l.remark && <div style={{ color: '#6B7280' }}>{l.remark}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
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

      {showConfirmAll && (
        <Modal title={`Confirm all ${queue.length} orders?`} subtitle="ยืนยันทั้งหมด">
          <div className="modal-body">Every order in the verification queue will be marked Final Closed. This cannot be undone.</div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" onClick={() => setShowConfirmAll(false)}>
              Cancel
            </button>
            <button className="modal-footer-btn btn-success" style={{ minWidth: 170, border: 0 }} disabled={busy} onClick={confirmAll}>
              {busy ? 'Confirming…' : `Confirm all ${queue.length}`}
            </button>
          </ModalFooter>
        </Modal>
      )}

      {showReject && selected && (
        <Modal title={`Reject ${selected.order_no} for correction?`} subtitle="ส่งกลับเพื่อแก้ไข">
          <div className="modal-body" style={{ paddingTop: 14 }}>
            The order returns to <strong>Correction in Progress</strong> for the picker to re-check. A reason is required and written to the audit trail.
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
