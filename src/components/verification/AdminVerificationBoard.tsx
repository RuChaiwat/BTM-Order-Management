'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'
import { formatLocationDisplay } from '../../lib/locations/locationDisplay'

interface VerificationLine {
  line_id: string
  sku: string
  sku_barcode: string | null
  item_description: string | null
  bin_code: string
  qty: number
  uom_code: string | null
}

interface QueueOrder {
  order_id: string
  order_no: string
  store_code: string
  planned_pieces: number
  pickerName: string
  waitMinutes: number
  completion?: { actual_pieces: number | null; result: string; picker_completed_time: string } | null
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

/**
 * §12.3 Admin Verification redesign — the picker only reports a coarse result (§12.2: Completed /
 * Completed with Short, no line detail), so the per-line short quantity and reason are entered
 * here instead, checked against the real WMS confirmation. Queue (left) is sorted by the order in
 * which pickers finished, oldest first; selecting an order shows every one of its lines (middle)
 * for Admin to mark short + enter reason/qty, same interaction the picker used to have on Pick
 * Completion before this redesign moved it here.
 */
export function AdminVerificationBoard({
  queue,
  linesByOrder,
  shortPickReasons,
  initialSelectedId,
}: {
  queue: QueueOrder[]
  linesByOrder: Record<string, VerificationLine[]>
  shortPickReasons: Reason[]
  initialSelectedId?: string
}) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  // A deep link from Pending Action Monitor names an order_id directly -- fall back to the queue's
  // own default (oldest first) when it's missing or the order isn't actually in this queue.
  const [selectedId, setSelectedId] = useState(initialSelectedId && queue.some((o) => o.order_id === initialSelectedId) ? initialSelectedId : queue[0]?.order_id ?? '')
  const [lineState, setLineState] = useState<Record<string, LineState>>({})
  const [initializedFor, setInitializedFor] = useState<string | null>(null)
  const [showReject, setShowReject] = useState(false)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Combined so a button stays disabled/spinning through the network request AND the
  // router.refresh() that follows it, not just the request -- closing the modal / re-enabling
  // buttons before the queue has actually re-rendered with fresh data left a window where the
  // just-closed order still looked actionable.
  const working = busy || isRefreshing

  const selected = queue.find((o) => o.order_id === selectedId) ?? queue[0]
  const orderLines = useMemo(() => (selected ? linesByOrder[selected.order_id] ?? [] : []), [selected, linesByOrder])

  // Lazily (re)initialize per-line draft state the first time an order is opened, rather than in a
  // useEffect -- avoids an extra render and keeps each order's draft independent when switching
  // back and forth in the queue.
  if (selected && initializedFor !== selected.order_id) {
    const initial: Record<string, LineState> = {}
    for (const l of orderLines) {
      initial[l.line_id] = { isShort: false, pickedQty: String(l.qty), reasonCode: shortPickReasons[0]?.reason_code ?? '', remark: '' }
    }
    setLineState(initial)
    setInitializedFor(selected.order_id)
  }

  function selectOrder(id: string) {
    setSelectedId(id)
    setError(null)
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
    selected !== undefined &&
    orderLines.length > 0 &&
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

  async function postFinalClose(orderId: string, lines: { line_id: string; picked_qty: number; short_reason_code?: string; remark?: string }[]) {
    const res = await apiFetch('/api/admin-verifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: orderId, decision: 'final_close', lines }),
    })
    if (!res.ok) {
      const body = await res.json()
      throw new Error(body.error)
    }
  }

  async function confirm() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const lines = orderLines.map((l) => {
        const st = lineState[l.line_id]
        return { line_id: l.line_id, picked_qty: st.isShort ? Number(st.pickedQty) : l.qty, short_reason_code: st.isShort ? st.reasonCode : undefined, remark: st.isShort ? st.remark || undefined : undefined }
      })
      await postFinalClose(selected.order_id, lines)
      setBusy(false)
      startRefresh(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  async function reject() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/admin-verifications', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_id: selected.order_id, decision: 'reject', reject_reason: rejectReason || 'Rejected for correction' }),
      })
      if (!res.ok) {
        const body = await res.json()
        throw new Error(body.error)
      }
      setShowReject(false)
      setRejectReason('')
      setBusy(false)
      startRefresh(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  // Confirm All only ever applies to orders the picker reported as fully picked -- every line
  // defaults to its full ordered quantity, so there's genuinely nothing for Admin to enter. An
  // order the picker reported short always needs to be opened individually: blindly bulk-closing
  // it would record a real shortage as fully picked with no reason on file.
  const fullyPickedOrders = queue.filter((o) => o.completion?.result === '100_percent')
  async function confirmAll() {
    setBusy(true)
    setError(null)
    const failures: string[] = []
    for (const o of fullyPickedOrders) {
      const lines = (linesByOrder[o.order_id] ?? []).map((l) => ({ line_id: l.line_id, picked_qty: l.qty }))
      try {
        await postFinalClose(o.order_id, lines)
      } catch (e) {
        failures.push(`${o.order_no}: ${(e as Error).message}`)
      }
    }
    setBusy(false)
    setShowConfirmAll(false)
    if (failures.length > 0) setError(failures.join('; '))
    startRefresh(() => router.refresh())
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '280px 1fr 340px', gap: 16, alignItems: 'start' }}>
        <div className="card">
          <div className="card-title">Verification queue</div>
          <div className="card-subtitle" style={{ marginBottom: 10 }}>
            คิวรอตรวจสอบ · {queue.length} order
          </div>
          <button className="btn btn-success btn-sm btn-block" style={{ marginBottom: 10 }} disabled={fullyPickedOrders.length === 0 || working} onClick={() => setShowConfirmAll(true)}>
            Confirm All 100% ({fullyPickedOrders.length})
          </button>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 560, overflowY: 'auto' }}>
            {queue.map((o) => (
              <button
                key={o.order_id}
                onClick={() => selectOrder(o.order_id)}
                style={{
                  textAlign: 'left',
                  border: o.order_id === selected?.order_id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: 'var(--color-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span className="link" style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {o.order_no}
                  </span>
                  <span className={`badge badge-${o.completion?.result === '100_percent' ? 'success' : 'warning'}`} style={{ fontSize: 10 }}>
                    {o.completion?.result === '100_percent' ? '100%' : 'ไม่ครบ'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  {o.pickerName} · รอ {o.waitMinutes} นาที
                </div>
              </button>
            ))}
            {queue.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>ไม่มี order รอตรวจสอบ</span>}
          </div>
        </div>

        <div className="card">
          {selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div>
                  <span className="card-title">{selected.order_no}</span>
                  <span className="card-subtitle" style={{ marginLeft: 8 }}>
                    {selected.store_code}
                  </span>
                </div>
                <span className={`badge badge-${selected.completion?.result === '100_percent' ? 'success' : 'warning'}`} style={{ marginLeft: 'auto' }}>
                  {selected.completion?.result === '100_percent' ? 'Picker ปิดงาน 100%' : 'Picker ปิดงานไม่ครบ'}
                </span>
              </div>
              <div style={{ marginBottom: 12 }} />
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: 28 }} />
                  <col style={{ width: '32%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '13%' }} />
                  <col style={{ width: '23%' }} />
                  <col style={{ width: '15%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th style={{ width: 28 }} />
                    <th>SKU</th>
                    <th>BIN</th>
                    <th>ORDERED</th>
                    <th>REASON</th>
                    <th>
                      ACTUAL
                      <br />
                      QTY
                    </th>
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
                            title="หยิบไม่ครบ?"
                          >
                            {st.isShort ? '✓' : ''}
                          </button>
                        </td>
                        <td style={{ overflowWrap: 'break-word' }}>
                          {l.sku}
                          {l.sku_barcode && <div style={{ fontSize: 11, color: '#6B7280' }}>Barcode: {l.sku_barcode}</div>}
                          {l.item_description && <div style={{ fontSize: 11, color: '#6B7280' }}>{l.item_description}</div>}
                        </td>
                        <td>{formatLocationDisplay(l.bin_code)}</td>
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
                        ไม่พบรายการสินค้าของ order นี้
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>
                ทำเครื่องหมายรายการที่หยิบไม่ครบ แล้วระบุเหตุผลและจำนวนจริง · ตรวจสอบกับระบบ WMS
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-secondary)' }}>เลือก order จากคิว</span>
          )}
        </div>

        <div className="card">
          <div className="card-title">Verification Summary</div>
          <div className="card-subtitle" style={{ marginBottom: 14 }}>
            สรุปผลตรวจสอบ
          </div>
          {selected ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12.5, marginBottom: 14 }}>
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>ชิ้นที่สั่ง</span>
                  <div style={{ fontWeight: 700, fontSize: 17 }}>{totalOrdered}</div>
                </div>
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>ชิ้นที่หยิบจริง</span>
                  <div style={{ fontWeight: 700, fontSize: 17, color: totalPicked < totalOrdered ? '#F59E0B' : '#16A34A' }}>{totalPicked}</div>
                </div>
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>Picker</span>
                  <div style={{ fontWeight: 700 }}>{selected.pickerName}</div>
                </div>
                <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
                  <span style={{ color: '#6B7280', fontSize: 11 }}>เวลารอ</span>
                  <div style={{ fontWeight: 700 }}>{selected.waitMinutes} นาที</div>
                </div>
              </div>
              <div style={{ marginBottom: 14 }}>
                <span className={`badge badge-${shortLines.length > 0 ? 'warning' : 'success'}`}>{shortLines.length > 0 ? `ไม่ครบ ${shortLines.length} รายการ` : 'หยิบครบ 100%'}</span>
              </div>
              {error && <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
              <div className="mt-auto" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                <button className="btn btn-success" disabled={!readyToConfirm || working} onClick={confirm}>
                  {working && <Spinner />}
                  {working ? 'Working…' : 'Final Close'}
                </button>
                <button className="btn btn-danger-outline" style={{ fontWeight: 700 }} disabled={working} onClick={() => setShowReject(true)}>
                  Reject for correction
                </button>
              </div>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-secondary)' }}>—</span>
          )}
        </div>
      </div>

      {showConfirmAll && (
        <Modal title={`Confirm all ${fullyPickedOrders.length} fully-picked orders?`} subtitle="ยืนยันเฉพาะ order ที่ Picker ปิดงาน 100%" onSubmit={confirmAll}>
          <div className="modal-body">
            ทุก order ที่ Picker แจ้งว่าหยิบครบ (100%) จะถูก Final Close โดยบันทึกทุกรายการเต็มจำนวนที่สั่ง · order ที่แจ้ง Short Pick จะไม่รวมอยู่ด้วย ให้เปิดตรวจทีละ order ·
            ไม่สามารถย้อนกลับได้
          </div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setShowConfirmAll(false)}>
              Cancel
            </button>
            <button type="submit" className="modal-footer-btn btn-success" style={{ minWidth: 170, border: 0 }} disabled={working} autoFocus>
              {working && <Spinner />}
              {working ? 'Confirming…' : `Confirm all ${fullyPickedOrders.length}`}
            </button>
          </ModalFooter>
        </Modal>
      )}

      {showReject && selected && (
        <Modal title={`Reject ${selected.order_no} for correction?`} subtitle="ส่งกลับเพื่อแก้ไข" onSubmit={reject}>
          <div className="modal-body" style={{ paddingTop: 14 }}>
            Order จะกลับไปสถานะ <strong>ส่งกลับแก้ไข</strong> ให้ Picker ตรวจซ้ำ · ต้องระบุเหตุผล และระบบจะบันทึกไว้ในประวัติ
          </div>
          <div style={{ padding: '16px 24px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              เหตุผล <span style={{ color: '#DC2626' }}>*</span>
            </div>
            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="เช่น ยังไม่ได้ตรวจจำนวนที่ไม่ครบที่ Bin"
              style={{ width: '100%', minHeight: 76, border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit' }}
              autoFocus
            />
          </div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setShowReject(false)}>
              Cancel
            </button>
            <button type="submit" className="modal-footer-btn btn-danger" style={{ minWidth: 170, border: 0 }} disabled={!rejectReason || working}>
              {working && <Spinner />}
              Reject &amp; notify picker
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
