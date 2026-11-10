'use client'

import { useMemo, useState } from 'react'
import { ImportErrorsViewer } from '@/components/ImportErrorsViewer'
import { Pagination } from '@/components/Pagination'
import { formatDateTime } from '@/lib/formatDate'

interface ImportBatch {
  import_id: string
  file_name: string
  uploaded_at: string
  status: string
  total_rows: number
  success_rows: number
  error_rows: number
  /** From the import's audit_logs entry ('orders.import'); null when that entry isn't available. */
  new_orders: number | null
  /** Orders already in the system (same Warehouse + Order No + Order Date) -- not created again,
   * their lines were refreshed from the file instead. */
  duplicate_orders: number | null
}

const PAGE_SIZE = 20

type SortKey = 'file_name' | 'uploaded_at' | 'status' | 'new_orders' | 'duplicate_orders' | 'total_rows' | 'success_rows' | 'error_rows'

function sortValue(b: ImportBatch, key: SortKey): string | number {
  return b[key] ?? -1
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

function SortHeader({ label, sortKey, sort, onSort }: { label: React.ReactNode; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (key: SortKey) => void }) {
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
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="FILE" sortKey="file_name" sort={sort} onSort={toggleSort} />
            <SortHeader label="UPLOADED" sortKey="uploaded_at" sort={sort} onSort={toggleSort} />
            <SortHeader label="STATUS" sortKey="status" sort={sort} onSort={toggleSort} />
            <SortHeader label={<>NEW<br />ORDERS</>} sortKey="new_orders" sort={sort} onSort={toggleSort} />
            <SortHeader label={<>DUPLICATE<br />ORDERS</>} sortKey="duplicate_orders" sort={sort} onSort={toggleSort} />
            <SortHeader label="ROWS" sortKey="total_rows" sort={sort} onSort={toggleSort} />
            <SortHeader label="SUCCESS" sortKey="success_rows" sort={sort} onSort={toggleSort} />
            <SortHeader label="ERRORS" sortKey="error_rows" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((b) => (
            <tr key={b.import_id}>
              <td style={{ overflowWrap: 'break-word' }}>{b.file_name}</td>
              <td>{formatDateTime(b.uploaded_at)}</td>
              <td>
                <span className={`badge badge-${b.status === 'completed' ? 'success' : b.status === 'failed' ? 'danger' : 'warning'}`}>{b.status}</span>
              </td>
              <td style={{ fontWeight: 700 }}>{b.new_orders == null ? '–' : b.new_orders.toLocaleString()}</td>
              <td title="ออเดอร์ที่มีอยู่ในระบบแล้ว (Warehouse + Order No + วันที่ออเดอร์ ตรงกัน) — ไม่สร้างใหม่ แต่อัปเดตรายการสินค้าจากไฟล์">
                {b.duplicate_orders == null ? '–' : b.duplicate_orders > 0 ? <span className="badge badge-warning">{b.duplicate_orders.toLocaleString()}</span> : 0}
              </td>
              <td>{b.total_rows.toLocaleString()}</td>
              <td>{b.success_rows.toLocaleString()}</td>
              <td>
                <ImportErrorsViewer importId={b.import_id} errorCount={b.error_rows} />
              </td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
                No imports yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
    </>
  )
}
