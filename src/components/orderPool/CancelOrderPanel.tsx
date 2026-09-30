'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'

interface CancelReason {
  reason_code: string
  label_en: string
}

interface FoundOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  status: string
}

/** §12.1.2/FR-028/029: cancelling an order had an API (app/api/orders/[orderId]/cancel) but no way
 * to reach it from the UI at all -- this is that missing entry point. Scan/type an Order No the
 * same way Work Assignment's Criteria panel does, only ever surfacing a Cancel action once the
 * order is confirmed still New/Pending (the one status the API allows cancelling from). */
export function CancelOrderPanel({ reasons }: { reasons: CancelReason[] }) {
  const router = useRouter()
  const scanInputRef = useRef<HTMLInputElement>(null)
  const [scanValue, setScanValue] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [found, setFound] = useState<FoundOrder | null>(null)
  const [reasonCode, setReasonCode] = useState(reasons[0]?.reason_code ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  // Any lookup error puts the cursor straight back in the box with its (unchanged) value selected,
  // ready to scan straight over -- no mouse or manual clear needed.
  useEffect(() => {
    if (scanError) {
      scanInputRef.current?.focus()
      scanInputRef.current?.select()
    }
  }, [scanError])

  async function lookup() {
    const value = scanValue.trim()
    if (!value) return
    setLoading(true)
    setScanError(null)
    const res = await apiFetch(`/api/orders/lookup?order_no=${encodeURIComponent(value)}`)
    const body = await res.json()
    setLoading(false)
    if (!res.ok) {
      setScanError(body.error)
      return
    }
    setFound(body.order)
    setScanValue('')
  }

  function closeConfirm() {
    setFound(null)
    setSubmitError(null)
    scanInputRef.current?.focus()
  }

  async function confirmCancel() {
    if (!found) return
    const reason = reasons.find((r) => r.reason_code === reasonCode)?.label_en
    if (!reason) return
    setSubmitting(true)
    setSubmitError(null)
    const res = await apiFetch(`/api/orders/${found.order_id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason }),
    })
    const body = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setSubmitError(body.error)
      return
    }
    setFound(null)
    router.refresh()
    scanInputRef.current?.focus()
  }

  return (
    <div className="card">
      <div className="card-title">Cancel Order</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        ยกเลิกออเดอร์ · เฉพาะออเดอร์ที่ยังไม่ถูก Assign (สถานะ New/Pending)
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          ref={scanInputRef}
          className="control"
          placeholder="Scan or type Order No…"
          value={scanValue}
          onChange={(e) => setScanValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && lookup()}
          style={{ flex: '1 1 240px', maxWidth: 320 }}
          autoFocus
        />
        <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={lookup}>
          {loading && <Spinner />}
          {loading ? 'Looking up…' : 'Find order'}
        </button>
      </div>
      {scanError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{scanError}</div>}

      {found && (
        <Modal title={`Cancel ${found.order_no}?`} subtitle="ยืนยันการยกเลิกออเดอร์ · บันทึกเหตุผลถาวร" onSubmit={confirmCancel}>
          <div className="modal-body">
            Store {found.store_code} · {found.planned_pieces.toLocaleString()} planned pieces. This order will move to Cancelled and can never be assigned or picked.
          </div>
          <div className="field" style={{ marginTop: 4 }}>
            <label className="field-label">
              Cancel reason <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <select className="field-input" style={{ border: '1px solid var(--color-border)' }} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} autoFocus>
              {reasons.map((r) => (
                <option key={r.reason_code} value={r.reason_code}>
                  {r.label_en}
                </option>
              ))}
            </select>
          </div>
          {submitError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{submitError}</div>}
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" disabled={submitting} onClick={closeConfirm}>
              Back
            </button>
            <button type="submit" className="modal-footer-btn btn-danger" style={{ minWidth: 170, border: 0 }} disabled={submitting || !reasonCode}>
              {submitting && <Spinner />}
              {submitting ? 'Cancelling…' : 'Confirm cancel'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
