'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { batchStatusLabel, batchStatusTone } from '@/lib/matching/batchStatus'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { Modal, ModalFooter } from '@/components/Modal'
import { Spinner } from '@/components/Spinner'

interface Batch {
  consol_batch_id: string
  batch_no: string
  order_date: string
  priority: string
  stores_count: number
  orders_count: number
  unique_sku_count: number
  total_pieces: number
  status: string
  released_at: string | null
  report_generated_at: string | null
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#16A34A', P2: '#2563EB', P3: '#F59E0B', P4: '#DC2626' }
const PAGE_SIZE = 15

type SortKey = 'batch_no' | 'order_date' | 'priority' | 'stores_count' | 'orders_count' | 'total_pieces' | 'released_at' | 'status'

function sortValue(b: Batch, key: SortKey): string | number {
  const v = b[key]
  return v === null ? '' : v
}

export function ConsolidationPickReportBoard({ batches }: { batches: Batch[] }) {
  const router = useRouter()
  const [busyBatch, setBusyBatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'released_at', dir: 'asc' })
  const [page, setPage] = useState(1)

  // Marking a batch Completed here has the same real effect as the picker confirming through Pick
  // Completion -- it used to only flip consolidation_batches.status, leaving every order inside it
  // stuck at Assigned/In Progress forever (invisible to Admin Verification). 100% vs Short applies
  // to every order in the batch at once, same as Pick Completion's own "Completed All" -- a
  // genuinely mixed batch (some 100%, some short) still needs those confirmed individually from
  // Pick Completion instead.
  const [completeTarget, setCompleteTarget] = useState<string | null>(null)

  async function markCompleted(batchId: string, result: '100_percent' | 'short') {
    setBusyBatch(batchId)
    setError(null)
    const res = await fetch(`/api/consolidation-batches/${batchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete', result }),
    })
    const body = await res.json()
    setBusyBatch(null)
    setCompleteTarget(null)
    if (!res.ok) {
      setError(body.error)
      return
    }
    router.refresh()
  }

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }))
    setPage(1)
  }

  const sorted = useMemo(() => {
    const copy = [...batches]
    copy.sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [batches, sort])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sort.key === sortKey
    return (
      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(sortKey)}>
        {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
      </th>
    )
  }

  const completeBatch = batches.find((b) => b.consol_batch_id === completeTarget) ?? null

  return (
    <>
      {/* No minHeight:0 -- .app-shell is a fixed 100vh flex column, so a flex item allowed to
          shrink below its content gets squeezed by the flex algorithm once total page content
          exceeds the viewport, and .card has no overflow:hidden of its own, so the table's
          overflow rows would spill out past the card's bottom edge instead of the page just
          scrolling (same fix as Zone Dashboard/Control Tower). */}
      <div className="card">
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Active pick &amp; sort worklist</span>
        <span className="card-subtitle">click a column to sort</span>
      </div>
      {error && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="BATCH" sortKey="batch_no" />
            <SortHeader label="ORDER DATE" sortKey="order_date" />
            <SortHeader label="PRIORITY" sortKey="priority" />
            <SortHeader label="STORES" sortKey="stores_count" />
            <SortHeader label="ORDERS" sortKey="orders_count" />
            <SortHeader label="PIECES" sortKey="total_pieces" />
            <SortHeader label="RELEASED" sortKey="released_at" />
            <SortHeader label="STATUS" sortKey="status" />
            <th />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((b) => (
            <tr key={b.consol_batch_id}>
              <td className="link">
                <Link href={`/pick-report/${b.consol_batch_id}`}>{b.batch_no}</Link>
              </td>
              <td>{formatDate(b.order_date)}</td>
              <td>
                <span style={{ color: PRIORITY_COLOR[b.priority], fontWeight: 700 }}>{b.priority}</span>
              </td>
              <td>{b.stores_count}</td>
              <td>{b.orders_count}</td>
              <td style={{ fontWeight: 700 }}>{b.total_pieces}</td>
              <td>{b.released_at ? formatDateTime(b.released_at) : '—'}</td>
              <td>
                <span className={`badge badge-${batchStatusTone(b.status)}`}>{batchStatusLabel(b.status)}</span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  {/* An <a> (what Link renders) is display:inline by default, so `height` is
                      silently ignored on it -- explicit inline-flex is what actually makes this
                      match the <button> next to it, which is inline-block by default and does
                      honor height. */}
                  <Link
                    href={`/pick-report/${b.consol_batch_id}`}
                    className="btn btn-secondary btn-sm"
                    style={{ height: 28, padding: '0 10px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                  >
                    Open report
                  </Link>
                  <button
                    className="btn btn-success btn-sm"
                    style={{ height: 28, padding: '0 10px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                    disabled={busyBatch === b.consol_batch_id}
                    onClick={() => setCompleteTarget(b.consol_batch_id)}
                  >
                    Mark completed
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={9} style={{ color: 'var(--color-text-secondary)' }}>
                Nothing released and active right now — release a batch from Matching Analysis &amp; Batch Review.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12.5 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Page {page} of {totalPages} · {sorted.length} batch(es)
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next
          </button>
        </div>
      )}
      </div>

      {completeBatch && (
        <Modal title={`Mark ${completeBatch.batch_no} completed`} subtitle="ยืนยันผลการหยิบของทั้ง Batch · หยุดเวลาของทุกออเดอร์ในกลุ่มนี้">
          <div className="modal-body">
            All {completeBatch.orders_count} order(s) in this batch will be marked picked and sent to Admin Verification. Choose 100% only if every order in the batch was fully picked --
            otherwise use Completed with Short (Admin will record the actual short quantity/reason per order during verification). If the batch is genuinely mixed, you can instead confirm each
            order individually from Pick Completion — this batch closes itself automatically once every order in it has been confirmed there.
          </div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" disabled={busyBatch === completeTarget} onClick={() => setCompleteTarget(null)}>
              Cancel
            </button>
            <button
              className="modal-footer-btn btn-warning"
              style={{ border: 0 }}
              disabled={busyBatch === completeTarget}
              onClick={() => completeBatch && markCompleted(completeBatch.consol_batch_id, 'short')}
            >
              {busyBatch === completeTarget && <Spinner />}
              Completed with Short
            </button>
            <button
              className="modal-footer-btn btn-success"
              style={{ minWidth: 160, border: 0 }}
              disabled={busyBatch === completeTarget}
              onClick={() => completeBatch && markCompleted(completeBatch.consol_batch_id, '100_percent')}
            >
              {busyBatch === completeTarget && <Spinner />}
              Completed (100%)
            </button>
          </ModalFooter>
        </Modal>
      )}
    </>
  )
}
