'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { batchStatusLabel, batchStatusTone } from '@/lib/matching/batchStatus'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { Pagination } from '@/components/Pagination'
import type { ConsolidationHistoryRow } from '@/lib/queries/consolidationHistory'

const PAGE_SIZE = 30

type SortKey = 'batch_no' | 'order_date' | 'priority' | 'stores_count' | 'orders_count' | 'total_pieces' | 'released_at' | 'status'

function sortRows(rows: ConsolidationHistoryRow[], key: SortKey, dir: 'asc' | 'desc'): ConsolidationHistoryRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

export function ConsolidationHistoryBoard({ rows }: { rows: ConsolidationHistoryRow[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'released_at', dir: 'desc' })
  const [page, setPage] = useState(1)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'batch_no' || key === 'status' ? 'asc' : 'desc' }))
    setPage(1)
  }

  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="card" style={{ flex: 1, minHeight: 0 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Consolidation History</span>
        <span className="card-subtitle">
          ประวัติการรวมออเดอร์ · {rows.length.toLocaleString()} batch(es) · click a column to sort
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="BATCH" sortKey="batch_no" sort={sort} onSort={toggleSort} />
            <SortHeader label="ORDER DATE" sortKey="order_date" sort={sort} onSort={toggleSort} />
            <SortHeader label="PRIORITY" sortKey="priority" sort={sort} onSort={toggleSort} />
            <SortHeader label="STORES" sortKey="stores_count" sort={sort} onSort={toggleSort} />
            <SortHeader label="ORDERS" sortKey="orders_count" sort={sort} onSort={toggleSort} />
            <SortHeader label="PIECES" sortKey="total_pieces" sort={sort} onSort={toggleSort} />
            <SortHeader label="RELEASED" sortKey="released_at" sort={sort} onSort={toggleSort} />
            <SortHeader label="STATUS" sortKey="status" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((b) => (
            <tr key={b.consol_batch_id}>
              <td className="link">
                <Link href={`/pick-report/${b.consol_batch_id}`}>{b.batch_no}</Link>
              </td>
              <td>{formatDate(b.order_date)}</td>
              <td>{b.priority}</td>
              <td>{b.stores_count}</td>
              <td>{b.orders_count}</td>
              <td>{b.total_pieces}</td>
              <td>{b.released_at ? formatDateTime(b.released_at) : '—'}</td>
              <td>
                <span className={`badge badge-${batchStatusTone(b.status)}`}>{batchStatusLabel(b.status)}</span>
              </td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
                No batches match this search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
    </div>
  )
}
