'use client'

import { useMemo, useState } from 'react'
import { apiFetch } from '@/lib/apiFetch'
import { formatDate } from '@/lib/formatDate'
import { batchStatusLabel, batchStatusTone } from '@/lib/matching/batchStatus'
import { Pagination } from '@/components/Pagination'

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

const PAGE_SIZE = 20

type OrderSortKey = 'orderNo' | 'storeCode' | 'pickerName' | 'status'
type BatchSortKey = 'batch_no' | 'order_date' | 'orders_count' | 'total_pieces' | 'status'

function sortOrders(rows: OpenOrder[], key: OrderSortKey, dir: 'asc' | 'desc'): OpenOrder[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = key === 'pickerName' ? a.pickerName ?? '' : a[key]
    const bv = key === 'pickerName' ? b.pickerName ?? '' : b[key]
    const cmp = av.localeCompare(bv)
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

function sortBatches(rows: ConsolidationBatch[], key: BatchSortKey, dir: 'asc' | 'desc'): ConsolidationBatch[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

function SortHeader<K extends string>({ label, sortKey, sort, onSort }: { label: React.ReactNode; sortKey: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (key: K) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

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
  const [docType, setDocType] = useState<DocType | 'consolidation'>('pick_sheet')
  const [pickerIdInput, setPickerIdInput] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [orderSort, setOrderSort] = useState<{ key: OrderSortKey; dir: 'asc' | 'desc' }>({ key: 'orderNo', dir: 'asc' })
  const [orderPage, setOrderPage] = useState(1)

  const [batchQuery, setBatchQuery] = useState('')
  const [batchResults, setBatchResults] = useState<ConsolidationBatch[]>([])
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const [batchSort, setBatchSort] = useState<{ key: BatchSortKey; dir: 'asc' | 'desc' }>({ key: 'batch_no', dir: 'asc' })
  const [batchPage, setBatchPage] = useState(1)

  // Scan/type a Picker ID directly rather than picking from a dropdown -- same "scan ID" pattern
  // as Work Assignment/Pick Completion, chosen because this warehouse has too many pickers for a
  // dropdown to stay usable.
  const pickerQuery = pickerIdInput.trim().toUpperCase()
  const matchedPicker = pickerQuery ? pickers.find((p) => p.picker_id === pickerQuery) : null
  const filteredOrders = useMemo(() => (pickerQuery ? orders.filter((o) => o.pickerId === pickerQuery) : orders), [orders, pickerQuery])
  const sortedOrders = useMemo(() => sortOrders(filteredOrders, orderSort.key, orderSort.dir), [filteredOrders, orderSort])
  const orderTotalPages = Math.max(1, Math.ceil(sortedOrders.length / PAGE_SIZE))
  const orderPageRows = sortedOrders.slice((orderPage - 1) * PAGE_SIZE, orderPage * PAGE_SIZE)

  function toggleOrderSort(key: OrderSortKey) {
    setOrderSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    setOrderPage(1)
  }

  const sortedBatches = useMemo(() => sortBatches(batchResults, batchSort.key, batchSort.dir), [batchResults, batchSort])
  const batchTotalPages = Math.max(1, Math.ceil(sortedBatches.length / PAGE_SIZE))
  const batchPageRows = sortedBatches.slice((batchPage - 1) * PAGE_SIZE, batchPage * PAGE_SIZE)

  function toggleBatchSort(key: BatchSortKey) {
    setBatchSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'batch_no' || key === 'status' ? 'asc' : 'desc' }))
    setBatchPage(1)
  }

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
    setBatchPage(1)
  }

  function printBatch(batchId: string) {
    window.open(`/pick-report/print?ids=${batchId}`, '_blank')
  }

  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Print & Reprint</span>
        <span className="card-subtitle">พิมพ์ / พิมพ์ซ้ำเอกสาร · เปิดจากเครื่องที่ไม่ใช่ Kiosk เพื่อเลือกเครื่องพิมพ์เอง</span>
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>
        <button className={`btn btn-sm ${docType === 'pick_sheet' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDocType('pick_sheet')}>
          Pick Sheet
        </button>
        <button className={`btn btn-sm ${docType === 'pick_slip' ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setDocType('pick_slip')}>
          Pick Slip
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
              <input
                className="control"
                placeholder="Scan or type Picker ID… (blank = all)"
                value={pickerIdInput}
                onChange={(e) => {
                  setPickerIdInput(e.target.value)
                  setSelected(new Set())
                  setOrderPage(1)
                }}
                style={{ width: 220 }}
              />
              {pickerQuery && <span style={{ fontSize: 12, color: matchedPicker ? 'var(--color-text-secondary)' : 'var(--color-danger)' }}>{matchedPicker ? matchedPicker.name_en : 'No picker with this ID'}</span>}
            </div>
            <button className="btn btn-primary btn-sm" disabled={selected.size === 0} onClick={printSelected}>
              Print {docType === 'pick_sheet' ? 'Pick Sheet' : 'Pick Slip'} ({selected.size})
            </button>
          </div>
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '6%' }} />
              <col style={{ width: '20%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '32%' }} />
              <col style={{ width: '28%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={filteredOrders.length > 0 && selected.size === filteredOrders.length} onChange={toggleAll} />
                </th>
                <SortHeader label="ORDER NO" sortKey="orderNo" sort={orderSort} onSort={toggleOrderSort} />
                <SortHeader label="STORE" sortKey="storeCode" sort={orderSort} onSort={toggleOrderSort} />
                <SortHeader label="PICKER" sortKey="pickerName" sort={orderSort} onSort={toggleOrderSort} />
                <SortHeader label="STATUS" sortKey="status" sort={orderSort} onSort={toggleOrderSort} />
              </tr>
            </thead>
            <tbody>
              {orderPageRows.map((o) => (
                <tr key={o.orderId} style={{ cursor: 'pointer' }} onClick={() => toggleSelected(o.orderId)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" checked={selected.has(o.orderId)} onChange={() => toggleSelected(o.orderId)} />
                  </td>
                  <td style={{ fontWeight: 700 }}>{o.orderNo}</td>
                  <td>{o.storeCode}</td>
                  <td style={{ overflowWrap: 'break-word' }}>{o.pickerName ?? '—'}</td>
                  <td>
                    <span className={`badge badge-${o.status === 'correction_in_progress' ? 'warning' : 'info'}`}>{STATUS_LABEL[o.status] ?? o.status}</span>
                  </td>
                </tr>
              ))}
              {orderPageRows.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                    No open orders{pickerQuery ? ' for this picker' : ''} right now.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {sortedOrders.length > 0 && <Pagination page={orderPage} totalPages={orderTotalPages} onChange={setOrderPage} />}
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
          <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '18%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '24%' }} />
              <col style={{ width: '18%' }} />
            </colgroup>
            <thead>
              <tr>
                <SortHeader label="BATCH" sortKey="batch_no" sort={batchSort} onSort={toggleBatchSort} />
                <SortHeader
                  label={
                    <>
                      ORDER
                      <br />
                      DATE
                    </>
                  }
                  sortKey="order_date"
                  sort={batchSort}
                  onSort={toggleBatchSort}
                />
                <SortHeader label="ORDERS" sortKey="orders_count" sort={batchSort} onSort={toggleBatchSort} />
                <SortHeader label="PIECES" sortKey="total_pieces" sort={batchSort} onSort={toggleBatchSort} />
                <SortHeader label="STATUS" sortKey="status" sort={batchSort} onSort={toggleBatchSort} />
                <th></th>
              </tr>
            </thead>
            <tbody>
              {batchPageRows.map((b) => (
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
              {batchPageRows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                    Search for a Batch No to find its report.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {sortedBatches.length > 0 && <Pagination page={batchPage} totalPages={batchTotalPages} onChange={setBatchPage} />}
        </>
      )}
    </div>
  )
}
