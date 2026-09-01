'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { batchStatusLabel, batchStatusTone } from '@/lib/matching/batchStatus'

interface Batch {
  consol_batch_id: string
  batch_no: string
  order_date: string
  priority: string
  match_pct: number | null
  stores_count: number
  orders_count: number
  unique_sku_count: number
  total_pieces: number
  status: string
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#16A34A', P2: '#2563EB', P3: '#F59E0B', P4: '#DC2626' }
const PAGE_SIZE = 10

type SortKey = 'batch_no' | 'priority' | 'match_pct' | 'stores_count' | 'orders_count' | 'total_pieces' | 'status'

function sortValue(b: Batch, key: SortKey): string | number {
  const v = b[key]
  return v === null ? -1 : v
}

export function MatchingBoard({
  batches,
  warehouseCode,
  unmatchedPendingCount,
  orderDate,
}: {
  batches: Batch[]
  warehouseCode: string
  unmatchedPendingCount: number
  orderDate: string
}) {
  const router = useRouter()
  const [dateInput, setDateInput] = useState(orderDate)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyBatch, setBusyBatch] = useState<string | null>(null)
  const [bulkBusy, setBulkBusy] = useState(false)
  const [bulkError, setBulkError] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'batch_no', dir: 'asc' })
  const [page, setPage] = useState(1)

  useEffect(() => {
    setDateInput(orderDate)
    setPage(1)
    setSelected(new Set())
  }, [orderDate])

  function goToDate(date: string) {
    router.push(`/matching-analysis?date=${date}`)
  }

  async function runMatching() {
    setRunning(true)
    setError(null)
    setResult(null)
    const res = await fetch('/api/matching/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouse_code: warehouseCode, order_date: dateInput }),
    })
    const body = await res.json()
    setRunning(false)
    if (!res.ok) return setError(body.error)
    setResult(body)
    // Run and review always show the same Order Date — jump the review list to whatever date was
    // just run, or just refresh in place if it was already the date being reviewed.
    if (dateInput !== orderDate) goToDate(dateInput)
    else router.refresh()
  }

  async function act(batchId: string, action: 'cancel') {
    setBusyBatch(batchId)
    await fetch(`/api/consolidation-batches/${batchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusyBatch(null)
    router.refresh()
  }

  /** Approve collapses the old two-step Approve-then-Release flow into one action, and the
   * system prints the batch's pick report immediately once it's approved — for one batch (row
   * action) or several at once (bulk). The print tab is opened synchronously, inside the click
   * handler, so browsers don't treat it as an unrequested popup once the approve call resolves. */
  async function approveAndPrint(batchIds: string[]) {
    if (batchIds.length === 0) return
    const printWindow = window.open('', '_blank')
    setBulkBusy(true)
    setBulkError(null)
    const approvedIds: string[] = []
    const failures: string[] = []
    for (const id of batchIds) {
      try {
        const res = await fetch(`/api/consolidation-batches/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'approve' }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error ?? 'Approve failed')
        approvedIds.push(id)
      } catch (e) {
        failures.push(`${id.slice(0, 8)}: ${(e as Error).message}`)
      }
    }
    setBulkBusy(false)
    setSelected(new Set())
    if (failures.length > 0) setBulkError(failures.join('; '))
    if (approvedIds.length > 0 && printWindow) {
      printWindow.location.href = `/pick-report/print?ids=${approvedIds.join(',')}`
    } else {
      printWindow?.close()
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
  const pageCandidateIds = pageRows.filter((b) => b.status === 'candidate').map((b) => b.consol_batch_id)
  const allPageCandidatesSelected = pageCandidateIds.length > 0 && pageCandidateIds.every((id) => selected.has(id))

  function toggleSelectAllOnPage() {
    setSelected((prev) => {
      const next = new Set(prev)
      if (allPageCandidatesSelected) pageCandidateIds.forEach((id) => next.delete(id))
      else pageCandidateIds.forEach((id) => next.add(id))
      return next
    })
  }

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function SortHeader({ label, sortKey }: { label: string; sortKey: SortKey }) {
    const active = sort.key === sortKey
    return (
      <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => toggleSort(sortKey)}>
        {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
      </th>
    )
  }

  return (
    <div className="page-body">
      <div className="card">
        <div className="card-title">Run matching</div>
        <div className="card-subtitle" style={{ marginBottom: 12 }}>
          §10 pre-screen + P1-P4 clustering · {unmatchedPendingCount} pending orders not yet matched for this date
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div className="field">
            <label className="field-label">Order Date</label>
            <input
              type="date"
              className="field-input"
              value={dateInput}
              onChange={(e) => setDateInput(e.target.value)}
              style={{ border: '1px solid var(--color-border)' }}
            />
          </div>
          <button className="btn btn-primary btn-sm" disabled={running} onClick={runMatching}>
            {running ? 'Matching…' : 'Run matching'}
          </button>
          {dateInput !== orderDate && (
            <button className="btn btn-secondary btn-sm" onClick={() => goToDate(dateInput)}>
              View batches for this date
            </button>
          )}
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
        {result && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
            {String(result.eligible_count)} eligible · {String(result.excluded_over_max_sku)} excluded (over max SKU) · {(result.batches as unknown[]).length} batch(es) created ·{' '}
            {String(result.single_order_count)} routed to Single Order
          </div>
        )}
      </div>

      <div className="card" style={{ flex: 1, minHeight: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="card-title">Batch review — {orderDate}</div>
            <div className="card-subtitle" style={{ marginBottom: 12 }}>
              แดชบอร์ดตรวจแบตช์ · Approve prints the A4 pick report immediately
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {selected.size > 0 && (
              <button className="btn btn-primary btn-sm" disabled={bulkBusy} onClick={() => approveAndPrint([...selected])}>
                {bulkBusy ? 'Approving…' : `Approve selected (${selected.size})`}
              </button>
            )}
          </div>
        </div>
        {bulkError && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--color-danger)' }}>{bulkError}</div>}
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 28 }}>
                <input type="checkbox" checked={allPageCandidatesSelected} disabled={pageCandidateIds.length === 0} onChange={toggleSelectAllOnPage} />
              </th>
              <SortHeader label="BATCH NO" sortKey="batch_no" />
              <SortHeader label="PRIORITY" sortKey="priority" />
              <SortHeader label="MATCH %" sortKey="match_pct" />
              <SortHeader label="STORES" sortKey="stores_count" />
              <SortHeader label="ORDERS" sortKey="orders_count" />
              <SortHeader label="PIECES" sortKey="total_pieces" />
              <SortHeader label="STATUS" sortKey="status" />
              <th />
            </tr>
          </thead>
          <tbody>
            {pageRows.map((b) => (
              <tr key={b.consol_batch_id}>
                <td>
                  {b.status === 'candidate' && <input type="checkbox" checked={selected.has(b.consol_batch_id)} onChange={() => toggleSelect(b.consol_batch_id)} />}
                </td>
                <td className="link">
                  <Link href={`/pick-report/${b.consol_batch_id}`}>{b.batch_no}</Link>
                </td>
                <td>
                  <span style={{ color: PRIORITY_COLOR[b.priority], fontWeight: 700 }}>{b.priority}</span>
                </td>
                <td>{b.match_pct !== null ? `${Math.round(b.match_pct * 100)}%` : '—'}</td>
                <td>{b.stores_count}</td>
                <td>{b.orders_count}</td>
                <td style={{ fontWeight: 700 }}>{b.total_pieces}</td>
                <td>
                  <span className={`badge badge-${batchStatusTone(b.status)}`}>{batchStatusLabel(b.status)}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {b.status === 'candidate' && (
                      <button className="btn btn-primary btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={bulkBusy} onClick={() => approveAndPrint([b.consol_batch_id])}>
                        Approve
                      </button>
                    )}
                    {b.status === 'candidate' && (
                      <button className="btn btn-danger-outline btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busyBatch === b.consol_batch_id} onClick={() => act(b.consol_batch_id, 'cancel')}>
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--color-text-secondary)' }}>
                  No consolidation batches for {orderDate} — run matching above, or pick a different Order Date.
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
    </div>
  )
}
