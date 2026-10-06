'use client'

import { useMemo, useState } from 'react'
import { ImportErrorsViewer } from '@/components/ImportErrorsViewer'
import { formatDateTime } from '@/lib/formatDate'

interface ImportBatch {
  import_id: string
  file_name: string
  uploaded_at: string
  status: string
  total_rows: number
  success_rows: number
  error_rows: number
}

const PAGE_SIZE = 20

type SortKey = 'file_name' | 'uploaded_at' | 'status' | 'total_rows' | 'success_rows' | 'error_rows'

function sortValue(b: ImportBatch, key: SortKey): string | number {
  return b[key]
}

function sortRows(rows: ImportBatch[], key: SortKey, dir: 'asc' | 'desc'): ImportBatch[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = sortValue(a, key)
    const bv = sortValue(b, key)
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

export function RecentImportsTable({ rows }: { rows: ImportBatch[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'uploaded_at', dir: 'desc' })
  const [page, setPage] = useState(1)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'file_name' || key === 'status' ? 'asc' : 'desc' }))
    setPage(1)
  }

  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="FILE" sortKey="file_name" sort={sort} onSort={toggleSort} />
            <SortHeader label="UPLOADED" sortKey="uploaded_at" sort={sort} onSort={toggleSort} />
            <SortHeader label="STATUS" sortKey="status" sort={sort} onSort={toggleSort} />
            <SortHeader label="ROWS" sortKey="total_rows" sort={sort} onSort={toggleSort} />
            <SortHeader label="SUCCESS" sortKey="success_rows" sort={sort} onSort={toggleSort} />
            <SortHeader label="ERRORS" sortKey="error_rows" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((b) => (
            <tr key={b.import_id}>
              <td>{b.file_name}</td>
              <td>{formatDateTime(b.uploaded_at)}</td>
              <td>
                <span className={`badge badge-${b.status === 'completed' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'}`}>{b.status}</span>
              </td>
              <td>{b.total_rows}</td>
              <td>{b.success_rows}</td>
              <td>
                <ImportErrorsViewer importId={b.import_id} errorCount={b.error_rows} />
              </td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                No imports yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 10, marginTop: 12, fontSize: 12.5 }}>
          <span style={{ color: 'var(--color-text-secondary)' }}>
            Page {page} of {totalPages}
          </span>
          <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Prev
          </button>
          <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => setPage((p) => Math.min(totalPages, p + 1))}>
            Next
          </button>
        </div>
      )}
    </>
  )
}
