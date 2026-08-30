'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'

interface ActiveOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  status: string
}

interface OrderLine {
  line_id: string
  order_id: string
  sku: string
  sku_barcode: string | null
  item_description: string | null
  bin_code: string
  qty: number
  uom_code: string | null
  zone_code: string | null
}

interface Reason {
  reason_code: string
  label_en: string
}

interface LineState {
  isShort: boolean
  pickedQty: string
  reasonCode: string
  remark: string
}

/** §12.2 Pick Completion — the picker's field/PDA-style flow:
 * 1. scan the order number off the Pick Slip
 * 2. see every line on the order
 * 3. mark the item(s) that were short-picked
 * 4. pick a reason + enter the actual quantity for each short item
 * 5. confirm
 * 6. submit stops the order's clock and moves it to Waiting Admin Verification
 */
export function PickCompletionBoard({ orders, lines, shortPickReasons }: { orders: ActiveOrder[]; lines: OrderLine[]; shortPickReasons: Reason[] }) {
  const router = useRouter()
  const [scanValue, setScanValue] = useState('')
  const [scanError, setScanError] = useState<string | null>(null)
  const [orderId, setOrderId] = useState<string | null>(null)
  const [lineState, setLineState] = useState<Record<string, LineState>>({})
  const [remark, setRemark] = useState('')
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  const order = orders.find((o) => o.order_id === orderId) ?? null
  const orderLines = useMemo(() => lines.filter((l) => l.order_id === orderId), [lines, orderId])

  function selectOrder(id: string) {
    setOrderId(id)
    setScanError(null)
    setSubmitError(null)
    setRemark('')
    const initial: Record<string, LineState> = {}
    for (const l of lines.filter((ln) => ln.order_id === id)) {
      initial[l.line_id] = { isShort: false, pickedQty: String(l.qty), reasonCode: shortPickReasons[0]?.reason_code ?? '', remark: '' }
    }
    setLineState(initial)
  }

  function handleScan() {
    const match = orders.find((o) => o.order_no === scanValue.trim())
    if (!match) {
      setScanError(`No in-progress order '${scanValue}' found for you`)
      return
    }
    selectOrder(match.order_id)
    setScanValue('')
  }

  function toggleShort(lineId: string, qty: number) {
    setLineState((prev) => {
      const cur = prev[lineId]
      const isShort = !cur.isShort
      return { ...prev, [lineId]: { ...cur, isShort, pickedQty: isShort ? '' : String(qty) } }
    })
  }

  function updateLine(lineId: string, patch: Partial<LineState>) {
    setLineState((prev) => ({ ...prev, [lineId]: { ...prev[lineId], ...patch } }))
  }

  const shortLines = orderLines.filter((l) => lineState[l.line_id]?.isShort)
  const readyToConfirm =
    order !== null &&
    shortLines.every((l) => {
      const st = lineState[l.line_id]
      const qty = Number(st.pickedQty)
      return st.reasonCode && st.pickedQty !== '' && Number.isFinite(qty) && qty >= 0 && qty < l.qty
    })

  const totalOrdered = orderLines.reduce((s, l) => s + l.qty, 0)
  const totalPicked = orderLines.reduce((s, l) => {
    const st = lineState[l.line_id]
    return s + (st?.isShort ? Number(st.pickedQty || 0) : l.qty)
  }, 0)

  async function confirm() {
    if (!order) return
    setSubmitting(true)
    setSubmitError(null)
    const res = await fetch('/api/picker-completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.order_id,
        remark: remark || undefined,
        lines: orderLines.map((l) => {
          const st = lineState[l.line_id]
          return {
            line_id: l.line_id,
            picked_qty: st.isShort ? Number(st.pickedQty) : l.qty,
            short_reason_code: st.isShort ? st.reasonCode : undefined,
            remark: st.isShort ? st.remark || undefined : undefined,
          }
        }),
      }),
    })
    const body = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setSubmitError(body.error)
      return
    }
    setShowConfirm(false)
    setOrderId(null)
    setLineState({})
    router.refresh()
  }

  if (!order) {
    return (
      <div className="page-body" style={{ gap: 16 }}>
        <div className="card">
          <div className="card-title">Scan order</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            สแกน Order Number จาก Pick Slip เพื่อเริ่มบันทึกผลการหยิบ
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="control"
              placeholder="Scan or type order number…"
              value={scanValue}
              onChange={(e) => setScanValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleScan()}
              style={{ flex: 1, maxWidth: 320 }}
              autoFocus
            />
            <button className="btn btn-primary btn-sm" onClick={handleScan}>
              Open order
            </button>
          </div>
          {scanError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{scanError}</div>}
        </div>

        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-title">My in-progress orders</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            {orders.length} orders assigned and awaiting pick completion
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>ORDER NO.</th>
                <th>STORE</th>
                <th>PLANNED PCS</th>
                <th>STATUS</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.order_id}>
                  <td className="link">{o.order_no}</td>
                  <td>{o.store_code}</td>
                  <td>{o.planned_pieces}</td>
                  <td>
                    <span className={`badge badge-${o.status === 'correction_in_progress' ? 'warning' : 'info'}`}>
                      {o.status === 'correction_in_progress' ? 'Returned for correction' : o.status === 'in_progress' ? 'In Progress' : 'Assigned'}
                    </span>
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => selectOrder(o.order_id)}>
                      Open
                    </button>
                  </td>
                </tr>
              ))}
              {orders.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                    Nothing assigned to you right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 360px', gap: 16 }}>
        <div className="card" style={{ minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
            <span className="card-title">{order.order_no}</span>
            <span className="card-subtitle">{order.store_code}</span>
            <button className="btn btn-secondary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setOrderId(null)}>
              ← Back to scan
            </button>
          </div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            Tick any item that was short-picked, then set its reason and actual quantity.
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>SKU</th>
                <th>BIN</th>
                <th>ORDERED</th>
                <th>REASON</th>
                <th>ACTUAL QTY</th>
              </tr>
            </thead>
            <tbody>
              {orderLines.map((l) => {
                const st = lineState[l.line_id]
                if (!st) return null
                return (
                  <tr key={l.line_id} className={st.isShort ? 'row-flag' : undefined}>
                    <td>
                      <button
                        onClick={() => toggleShort(l.line_id, l.qty)}
                        className={`checkbox-box${st.isShort ? ' checked' : ''}`}
                        style={{ border: st.isShort ? 'none' : undefined, cursor: 'pointer', padding: 0 }}
                        title="Short picked?"
                      >
                        {st.isShort ? '✓' : ''}
                      </button>
                    </td>
                    <td>
                      {l.sku}
                      {l.sku_barcode && <div style={{ fontSize: 11, color: '#6B7280' }}>Barcode: {l.sku_barcode}</div>}
                      {l.item_description && <div style={{ fontSize: 11, color: '#6B7280' }}>{l.item_description}</div>}
                    </td>
                    <td>{l.bin_code}</td>
                    <td style={{ fontWeight: 700 }}>
                      {l.qty} {l.uom_code}
                    </td>
                    <td>
                      {st.isShort ? (
                        <select className="control" value={st.reasonCode} onChange={(e) => updateLine(l.line_id, { reasonCode: e.target.value })} style={{ width: 150 }}>
                          {shortPickReasons.map((r) => (
                            <option key={r.reason_code} value={r.reason_code}>
                              {r.label_en}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span style={{ color: '#9CA3AF' }}>—</span>
                      )}
                    </td>
                    <td>
                      {st.isShort ? (
                        <input
                          className="control"
                          type="number"
                          min={0}
                          max={l.qty - 1}
                          value={st.pickedQty}
                          onChange={(e) => updateLine(l.line_id, { pickedQty: e.target.value })}
                          style={{ width: 90 }}
                        />
                      ) : (
                        <span>{l.qty}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
              {orderLines.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                    No lines found for this order.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-title">Completion Summary</div>
          <div className="card-subtitle" style={{ marginBottom: 14 }}>
            สรุปผลการหยิบ
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12.5, marginBottom: 14 }}>
            <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
              <span style={{ color: '#6B7280', fontSize: 11 }}>Ordered pcs</span>
              <div style={{ fontWeight: 700, fontSize: 17 }}>{totalOrdered}</div>
            </div>
            <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
              <span style={{ color: '#6B7280', fontSize: 11 }}>Actual pcs</span>
              <div style={{ fontWeight: 700, fontSize: 17, color: totalPicked < totalOrdered ? '#F59E0B' : '#16A34A' }}>{totalPicked}</div>
            </div>
          </div>
          <div style={{ marginBottom: 14 }}>
            <span className={`badge badge-${shortLines.length > 0 ? 'warning' : 'success'}`}>{shortLines.length > 0 ? `${shortLines.length} item(s) short` : 'Full pick — 100%'}</span>
          </div>
          <div className="field">
            <label className="field-label">Overall remark (optional)</label>
            <textarea
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
              style={{ width: '100%', minHeight: 64, border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit' }}
            />
          </div>
          {submitError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{submitError}</div>}
          <div className="mt-auto" style={{ paddingTop: 16 }}>
            <button className="btn btn-primary" disabled={!readyToConfirm} onClick={() => setShowConfirm(true)}>
              Confirm completion · หยุดเวลา
            </button>
            <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'center', marginTop: 6 }}>Confirming stops this order's clock and sends it to Admin Verification.</div>
          </div>
        </div>
      </div>

      {showConfirm && (
        <Modal title="Confirm pick completion?" subtitle="ยืนยันผลการหยิบ">
          <div className="modal-body">
            <strong>{order.order_no}</strong> · {totalPicked} of {totalOrdered} pieces picked
            {shortLines.length > 0 ? `, ${shortLines.length} item(s) short` : ' — full pick'}. This sends the order to Admin Verification and cannot be edited afterward.
          </div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
            <button className="modal-footer-btn btn-primary" style={{ minWidth: 190, border: 0 }} disabled={submitting} onClick={confirm}>
              {submitting ? 'Submitting…' : 'Confirm & submit'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
