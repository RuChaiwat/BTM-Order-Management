'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { Pagination } from '../Pagination'
import { apiFetch } from '../../lib/apiFetch'
import { formatDate } from '../../lib/formatDate'

interface CancelReason {
  reason_code: string
  label_en: string
  label_th?: string | null
}

interface FoundOrder {
  order_id: string
  order_no: string
  store_code: string
  original_order_date: string
  planned_pieces: number | null
  unique_sku_count: number | null
  status: string
  status_th: string
}

function TrashIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}

/** Cancel Order: search part of an Order No or Store Code (20 per page); the trash icon at the end
 * of a row cancels that order -- only while it is still New (not assigned), the one status the
 * cancel API (app/api/orders/[orderId]/cancel) allows. The table starts empty until a search. */
export function CancelOrderPanel({ reasons }: { reasons: CancelReason[] }) {
  const router = useRouter()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [searched, setSearched] = useState('')
  const [rows, setRows] = useState<FoundOrder[] | null>(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [found, setFound] = useState<FoundOrder | null>(null)
  const [reasonCode, setReasonCode] = useState(reasons[0]?.reason_code ?? '')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  useEffect(() => {
    if (searchError) {
      searchInputRef.current?.focus()
      searchInputRef.current?.select()
    }
  }, [searchError])

  async function search(q: string, p: number) {
    if (!q) return
    setLoading(true)
    setSearchError(null)
    const res = await apiFetch(`/api/orders/search?q=${encodeURIComponent(q)}&page=${p}`)
    const body = await res.json()
    setLoading(false)
    if (!res.ok) {
      setSearchError(body.error)
      return
    }
    setSearched(q)
    setRows(body.rows)
    setTotal(body.total)
    setPage(body.page)
    setTotalPages(body.totalPages)
  }

  function closeConfirm() {
    setFound(null)
    setSubmitError(null)
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
    setDone(`ยกเลิก Order ${found.order_no} แล้ว`)
    setFound(null)
    router.refresh()
    await search(searched, page)
  }

  return (
    <div className="card">
      <div className="card-title">Cancel Order</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        ค้นหาและยกเลิกออเดอร์
      </div>
      <form
        style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
        onSubmit={(e) => {
          e.preventDefault()
          setDone(null)
          search(query.trim(), 1)
        }}
      >
        <input
          ref={searchInputRef}
          className="control"
          placeholder="ค้นหา Order No หรือ Store Code…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          style={{ flex: '1 1 240px', maxWidth: 320 }}
        />
        <button type="submit" className="btn btn-secondary btn-sm" disabled={loading || !query.trim()}>
          {loading && <Spinner />}
          {loading ? 'กำลังค้นหา…' : 'ค้นหา'}
        </button>
      </form>
      {searchError && <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-danger)' }}>{searchError}</div>}
      {done && <div style={{ marginTop: 8, fontSize: 12.5, color: '#16A34A', fontWeight: 600 }}>✓ {done}</div>}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
        พิมพ์บางส่วนของ Order No หรือ Store Code ได้ · ยกเลิกได้เฉพาะ order ที่ยังไม่ถูก Assign (สถานะ New)
        {rows && ` · พบ ${total.toLocaleString()} order`}
      </div>

      <table className="table" style={{ marginTop: 10, tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '22%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '22%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ORDER NO</th>
            <th>STORE</th>
            <th>วันที่ ORDER</th>
            <th>ชิ้น</th>
            <th>SKU</th>
            <th>สถานะ</th>
            <th style={{ textAlign: 'center' }}>ยกเลิก</th>
          </tr>
        </thead>
        <tbody>
          {(rows ?? []).map((o) => {
            const cancellable = o.status === 'new'
            return (
              <tr key={o.order_id}>
                <td style={{ fontWeight: 600, overflowWrap: 'break-word' }}>{o.order_no}</td>
                <td>{o.store_code}</td>
                <td>{formatDate(o.original_order_date)}</td>
                <td>{(o.planned_pieces ?? 0).toLocaleString()}</td>
                <td>{(o.unique_sku_count ?? 0).toLocaleString()}</td>
                <td>
                  <span className={`badge badge-${cancellable ? 'success' : o.status === 'cancelled' ? 'danger' : 'warning'}`}>{o.status_th}</span>
                </td>
                <td style={{ textAlign: 'center' }}>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    disabled={!cancellable}
                    onClick={() => {
                      setSubmitError(null)
                      setFound(o)
                    }}
                    title={cancellable ? `ยกเลิก Order ${o.order_no}` : o.status === 'cancelled' ? 'ยกเลิกแล้ว' : 'Assign แล้ว ยกเลิกไม่ได้'}
                    aria-label={`ยกเลิก Order ${o.order_no}`}
                    style={{ padding: '4px 8px', color: cancellable ? 'var(--color-danger)' : undefined, opacity: cancellable ? 1 : 0.35 }}
                  >
                    <TrashIcon />
                  </button>
                </td>
              </tr>
            )
          })}
          {(!rows || rows.length === 0) && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                {rows ? `ไม่พบ order ที่ตรงกับ "${searched}"` : 'ค้นหา Order No หรือ Store Code เพื่อแสดงรายการ'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows && rows.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={(p) => search(searched, p)} />}

      {found && (
        <Modal title={`Cancel ${found.order_no}?`} subtitle="ยืนยันการยกเลิกออเดอร์" onSubmit={confirmCancel}>
          <div className="modal-body">
            ร้าน {found.store_code} · {(found.planned_pieces ?? 0).toLocaleString()} ชิ้น · order นี้จะเปลี่ยนเป็นสถานะ Cancelled และจะมอบหมายงานหรือหยิบไม่ได้อีก (บันทึกเหตุผลถาวร)
          </div>
          <div className="field" style={{ marginTop: 4 }}>
            <label className="field-label">
              เหตุผลการยกเลิก <span style={{ color: '#DC2626' }}>*</span>
            </label>
            <select className="field-input" style={{ border: '1px solid var(--color-border)' }} value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} autoFocus>
              {reasons.map((r) => (
                <option key={r.reason_code} value={r.reason_code}>
                  {r.label_th || r.label_en}
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
