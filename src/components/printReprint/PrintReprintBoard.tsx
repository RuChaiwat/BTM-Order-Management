'use client'

import { useMemo, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { formatDate } from '@/lib/formatDate'
import { batchStatusLabel, batchStatusTone } from '@/lib/matching/batchStatus'

interface OpenOrder {
  orderId: string
  orderNo: string
  storeCode: string
  status: string
  pickerId: string | null
  pickerName: string | null
}

interface Picker {
  picker_id: string
  name_en: string
}

interface ConsolidationBatch {
  consol_batch_id: string
  batch_no: string
  order_date: string
  status: string
  orders_count: number
  total_pieces: number
}

const STATUS_LABEL: Record<string, string> = {
  assigned: 'Assigned',
  in_progress: 'In Progress',
  correction_in_progress: 'Returned for correction',
}

type DocType = 'pick_slip' | 'pick_sheet'

/** §Print & Reprint: a standalone place to (re)print Pick Slip/Pick Sheet/Order Consolidation
 * Report without needing to be on the screen that originally produced them. Opens the normal
 * browser print dialog (AutoPrint's window.print(), same as every other print route in this app) --
 * whether that comes up silent or shows the OS printer picker depends on whether THIS browser
 * instance has --kiosk-printing set, which is per-workstation, not per-page. Work Assignment's own
 * terminal is deliberately kiosk-mode so Pick Slip prints silently to its one thermal printer; this
 * menu is meant to be opened from an ordinary office browser instead, so the normal "pick a
 * printer" dialog comes up -- exactly what's needed when Pick Sheet (a regular A5 printer) and Pick
 * Slip (the thermal one) are different physical machines. */
export function PrintReprintBoard({ orders, pickers }: { orders: OpenOrder[]; pickers: Picker[] }) {
  const [docType, setDocType] = useState<DocType | 'consolidation'>('pick_slip')
  const [pickerFilter, setPickerFilter] = useState('ALL')
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const [batchQuery, setBatchQuery] = useState('')
  const [batchResults, setBatchResults] = useState<ConsolidationBatch[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)

  const filteredOrders = useMemo(() => (pickerFilter === 'ALL' ? orders : orders.filter((o) => o.pickerId === pickerFilter)), [orders, pickerFilter])

  function toggleSelected(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function toggleAll() {
    setSelected((prev) => (prev.size === filteredOrders.length ? new Set() : new Set(filteredOrders.map((o) => o.orderId))))
  }

  function printSelected() {
    if (selected.size === 0) return
    const base = docType === 'pick_sheet' ? '/pick-sheet/print' : '/pick-slip/print'
    window.open(`${base}?order_ids=${[...selected].join(',')}`, '_blank')
  }

  async function searchBatches() {
    const value = batchQuery.trim()
    if (!value) return
    setSearching(true)
    setSearchError(null)
    const res = await apiFetch(`/api/consolidation-batches/search?q=${encodeURIComponent(value)}`)
    const body = await res.json()
    setSearching(false)
    if (!res.ok) {
      setSearchError(body.error)
      return
    }
    setBatchResults(body.batches)
  }

  function printBatch(batchId: string) {
    window.open(`/pick-report/print?ids=${batchId}`, '_blank')
  }

  return (
    <div className="card" style={{ flex: 1, minHeight: 0 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Print & Reprint</span>
        <span className="card-subtitle">พิมพ์ / พิมพ์ซ้ำเอกสาร · เปิดจากเครื่องที่ไม่ใช่ Kiosk เพื่อเลือกเครื่องพิมพ์เอง</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn btn-sm ${docType === 'pick_slip' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDocType('pick_slip')}>
          Pick Slip
        </button>
        <button className={`btn btn-sm ${docType === 'pick_sheet' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDocType('pick_sheet')}>
          Pick Sheet
        </button>
        <button className={`btn btn-sm ${docType === 'consolidation' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDocType('consolidation')}>
          Order Consolidation Report
        </button>
      </div>

      {docType !== 'consolidation' ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Picker</span>
              <select
                className="control"
                value={pickerFilter}
                onChange={(e) => {
                  setPickerFilter(e.target.value)
                  setSelected(new Set())
                }}
              >
                <option value="ALL">All pickers</option>
                {pickers.map((p) => (
                  <option key={p.picker_id} value={p.picker_id}>
                    {p.name_en} ({p.picker_id})
                  </option>
                ))}
              </select>
            </div>
            <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={printSelected}>
              Print {docType === 'pick_sheet' ? 'Pick Sheet' : 'Pick Slip'} ({selected.size})
            </button>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={filteredOrders.length > 0 && selected.size === filteredOrders.length} onChange={toggleAll} />
                </th>
                <th>ORDER NO</th>
                <th>STORE</th>
                <th>PICKER</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {filteredOrders.map((o) => (
                <tr key={o.orderId} style={{ cursor: 'pointer' }} onClick={() => toggleSelected(o.orderId)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(o.orderId)} onChange={() => toggleSelected(o.orderId)} />
                  </td>
                  <td style={{ fontWeight: 700 }}>{o.orderNo}</td>
                  <td>{o.storeCode}</td>
                  <td>{o.pickerName ?? '—'}</td>
                  <td>
                    <span className={`badge badge-${o.status === 'correction_in_progress' ? 'warning' : 'info'}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                  </td>
                </tr>
              ))}
              {filteredOrders.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                    No open orders{pickerFilter === 'ALL' ? '' : ' for this picker'} right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
            <input
              className="control"
              placeholder="Search Batch No…"
              value={batchQuery}
              onChange={(e) => setBatchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchBatches()}
              style={{ width: 240 }}
            />
            <button className="btn btn-secondary btn-sm" disabled={searching} onClick={searchBatches}>
              {searching ? 'Searching…' : 'Search'}
            </button>
          </div>
          {searchError && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--color-danger)' }}>{searchError}</div>}
          <table className="table">
            <thead>
              <tr>
                <th>BATCH</th>
                <th>ORDER DATE</th>
                <th>ORDERS</th>
                <th>PIECES</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batchResults.map((b) => (
                <tr key={b.consol_batch_id}>
                  <td style={{ fontWeight: 700 }}>{b.batch_no}</td>
                  <td>{formatDate(b.order_date)}</td>
                  <td>{b.orders_count}</td>
                  <td>{b.total_pieces}</td>
                  <td>
                    <span className={`badge badge-${batchStatusTone(b.status)}`}>{batchStatusLabel(b.status)}</span>
                  </td>
                  <td>
                    <button className="btn btn-secondary btn-sm" onClick={() => printBatch(b.consol_batch_id)}>
                      Print
                    </button>
                  </td>
                </tr>
              ))}
              {batchResults.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                    Search for a Batch No to find its report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
