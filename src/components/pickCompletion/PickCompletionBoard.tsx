'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'

interface Picker {
  picker_id: string
  name_en: string
  name_th: string | null
}

interface PickerOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  status: string
  assigned_time: string | null
}

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  correction_in_progress: 'Returned for correction',
}

/**
 * §12.2 Pick Completion redesign — pickers use a Handheld to do the actual picking and never log
 * into this app themselves (see migration 0015), so this screen is operated by office staff on
 * their behalf: scan/type the Picker ID, see that picker's assigned orders, and mark each one
 * Completed or Completed with Short. No per-line quantity/reason entry here anymore -- that moves
 * to Admin Verification, checked against the real WMS confirmation. Confirming stops the order's
 * clock and forwards it to Admin Verification.
 *
 * Built as one responsive layout rather than a separate Handheld app: order rows are flex "cards"
 * with large tap targets that wrap to a single column on a narrow screen and lay out as a wider
 * row on a PC monitor, so the same page serves both without a second codebase to maintain.
 */
export function PickCompletionBoard() {
  const router = useRouter()
  const [scanValue, setScanValue] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [picker, setPicker] = useState<Picker | null>(null)
  const [orders, setOrders] = useState<PickerOrder[]>([])
  const [pending, setPending] = useState<{ orderId: string; result: '100_percent' | 'short' } | null>(null)
  const [showCompletedAll, setShowCompletedAll] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function lookupPicker() {
    const value = scanValue.trim().toUpperCase()
    if (!value) return
    setLoading(true)
    setScanError(null)
    const res = await apiFetch(`/api/picker-completions?picker_id=${encodeURIComponent(value)}`)
    const body = await res.json()
    setLoading(false)
    if (!res.ok) {
      setScanError(body.error)
      return
    }
    setPicker(body.picker)
    setOrders(body.orders)
    setScanValue('')
  }

  function switchPicker() {
    setPicker(null)
    setOrders([])
    setSubmitError(null)
  }

  async function refreshOrders() {
    if (!picker) return
    const res = await apiFetch(`/api/picker-completions?picker_id=${encodeURIComponent(picker.picker_id)}`)
    const body = await res.json()
    if (res.ok) setOrders(body.orders)
  }

  // Deliberately keeps `submitting` true (buttons stay disabled, modal stays open) through the
  // list refresh too, not just the POST itself -- closing the modal / re-enabling buttons before
  // the order list has actually been re-fetched left a window where the just-completed order was
  // still showing as actionable, and clicking it again raced a real request against stale UI.
  async function submitOne(orderId: string, result: '100_percent' | 'short') {
    if (!picker) return
    setSubmitting(true)
    setSubmitError(null)
    const res = await apiFetch('/api/picker-completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, picker_id: picker.picker_id, result }),
    })
    const body = await res.json()
    if (!res.ok) {
      setSubmitting(false)
      setPending(null)
      setSubmitError(body.error)
      return
    }
    await refreshOrders()
    setSubmitting(false)
    setPending(null)
    router.refresh()
  }

  async function completeAll() {
    if (!picker) return
    setSubmitting(true)
    setSubmitError(null)
    const failures: string[] = []
    for (const o of orders) {
      const res = await apiFetch('/api/picker-completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: o.order_id, picker_id: picker.picker_id, result: '100_percent' }),
      })
      if (!res.ok) {
        const body = await res.json()
        failures.push(`${o.order_no}: ${body.error}`)
      }
    }
    await refreshOrders()
    setSubmitting(false)
    setShowCompletedAll(false)
    if (failures.length > 0) setSubmitError(failures.join('; '))
    router.refresh()
  }

  if (!picker) {
    return (
      <div className="page-body" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-title">Scan Picker ID</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            สแกนหรือพิมพ์รหัส Picker เพื่อดูรายการงานที่มอบหมายให้พนักงานคนนั้น
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              className="control"
              placeholder="Scan or type Picker ID…"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && lookupPicker()}
              style={{ flex: '1 1 240px', maxWidth: 320, fontSize: 16, padding: '12px 14px' }}
              autoFocus
            />
            <button className="btn btn-primary" style={{ padding: '12px 24px', fontSize: 15 }} disabled={loading} onClick={lookupPicker}>
              {loading && <Spinner />}
              {loading ? 'Looking up…' : 'Open picker'}
            </button>
          </div>
          {scanError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{scanError}</div>}
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ gap: 16 }}>
        <div className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>
                {picker.name_en} <span style={{ fontWeight: 400, color: '#6B7280', fontSize: 13 }}>({picker.picker_id})</span>
              </div>
              {picker.name_th && <div style={{ fontSize: 12, color: '#6B7280' }}>{picker.name_th}</div>}
            </div>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-success btn-sm" disabled={orders.length === 0 || submitting} onClick={() => setShowCompletedAll(true)}>
                Completed All ({orders.length})
              </button>
              <button className="btn btn-secondary btn-sm" onClick={switchPicker}>
                ← Switch picker
              </button>
            </div>
          </div>
          <div className="card-subtitle" style={{ marginTop: 8 }}>
            {orders.length} order(s) assigned and awaiting pick completion
          </div>
        </div>

        {submitError && (
          <div className="card" style={{ padding: '10px 14px', color: 'var(--color-danger)', fontSize: 12.5 }}>
            {submitError}
          </div>
        )}

        {/* Card-per-order, not a <table> -- flex rows wrap naturally on a narrow Handheld screen
            instead of forcing horizontal scroll, so this same page works on PC and Handheld. */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {orders.map((o) => (
            <div key={o.order_id} className="card" style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: 16, flexWrap: 'wrap', padding: '14px 18px' }}>
              <div style={{ flex: '1 1 160px' }}>
                <div className="link" style={{ fontWeight: 700, fontSize: 15 }}>
                  {o.order_no}
                </div>
                <div style={{ fontSize: 12, color: '#6B7280' }}>{o.store_code}</div>
              </div>
              <div style={{ flex: '0 0 auto', textAlign: 'center' }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>{o.planned_pieces}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>planned pcs</div>
              </div>
              <div style={{ flex: '0 0 auto' }}>
                <span className={`badge badge-${o.status === 'correction_in_progress' ? 'warning' : 'info'}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
              </div>
              <div style={{ flex: '1 1 260px', display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button
                  className="btn btn-success"
                  style={{ padding: '12px 18px', fontSize: 14, flex: '1 1 auto', minWidth: 130 }}
                  disabled={submitting}
                  onClick={() => setPending({ orderId: o.order_id, result: '100_percent' })}
                >
                  ✓ Completed
                </button>
                <button
                  className="btn btn-warning"
                  style={{ padding: '12px 18px', fontSize: 14, flex: '1 1 auto', minWidth: 170 }}
                  disabled={submitting}
                  onClick={() => setPending({ orderId: o.order_id, result: 'short' })}
                >
                  Completed with Short
                </button>
              </div>
            </div>
          ))}
          {orders.length === 0 && <div className="card" style={{ color: 'var(--color-text-secondary)' }}>Nothing assigned to {picker.name_en} right now.</div>}
        </div>
      </div>

      {pending && (
        <Modal title={pending.result === '100_percent' ? 'Confirm Completed?' : 'Confirm Completed with Short?'} subtitle="ยืนยันผลการหยิบ · หยุดเวลา">
          <div className="modal-body">
            {orders.find((o) => o.order_id === pending.orderId)?.order_no}
            {pending.result === '100_percent'
              ? ' will be marked fully picked and sent to Admin Verification.'
              : ' will be marked short-picked and sent to Admin Verification, where the short quantity and reason are recorded.'}
            {' '}
            This stops the order&apos;s clock and cannot be edited afterward.
          </div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" onClick={() => setPending(null)}>
              Cancel
            </button>
            <button
              className={`modal-footer-btn ${pending.result === '100_percent' ? 'btn-success' : 'btn-warning'}`}
              style={{ minWidth: 190, border: 0 }}
              disabled={submitting}
              onClick={() => submitOne(pending.orderId, pending.result)}
            >
              {submitting && <Spinner />}
              {submitting ? 'Submitting…' : 'Confirm & submit'}
            </button>
          </ModalFooter>
        </Modal>
      )}

      {showCompletedAll && (
        <Modal title={`Mark all ${orders.length} orders Completed?`} subtitle="ยืนยันปิดงานทั้งหมด (100%)">
          <div className="modal-body">
            Every order currently assigned to <strong>{picker.name_en}</strong> will be marked fully picked (100%) and sent to Admin Verification. Use this only when nothing was short-picked
            today — a short-picked order should be confirmed individually with &quot;Completed with Short&quot; instead.
          </div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" onClick={() => setShowCompletedAll(false)}>
              Cancel
            </button>
            <button className="modal-footer-btn btn-success" style={{ minWidth: 190, border: 0 }} disabled={submitting} onClick={completeAll}>
              {submitting && <Spinner />}
              {submitting ? 'Submitting…' : `Complete all ${orders.length}`}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
