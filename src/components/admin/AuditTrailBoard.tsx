'use client'

import { useMemo, useState } from 'react'
import { formatDateTime } from '@/lib/formatDate'
import { Pagination } from '@/components/Pagination'

interface AuditTrailRow {
  id: string
  created_at: string
  user_id: string | null
  actionLabelEn: string
  actionLabelTh: string
  detail: string
}

const PAGE_SIZE = 30

export function AuditTrailBoard({ rows }: { rows: AuditTrailRow[] }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter(
      (r) => (r.user_id ?? '').toLowerCase().includes(q) || r.actionLabelEn.toLowerCase().includes(q) || r.actionLabelTh.includes(q) || r.detail.toLowerCase().includes(q),
    )
  }, [rows, query])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageRows = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  function onQueryChange(value: string) {
    setQuery(value)
    setPage(1)
  }

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
        <input
          className="control"
          style={{ width: 320 }}
          placeholder="Search by user or action · ค้นหาผู้ใช้งานหรือรายการ"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {filtered.length.toLocaleString()} of {rows.length.toLocaleString()} action(s)
        </span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>TIME</th>
            <th>USER</th>
            <th>ACTION</th>
            <th>DETAIL</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((a) => (
            <tr key={a.id}>
              <td style={{ whiteSpace: 'nowrap' }}>{formatDateTime(a.created_at)}</td>
              <td>{a.user_id ?? 'system'}</td>
              <td>
                <div style={{ fontWeight: 600 }}>{a.actionLabelEn}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)' }}>{a.actionLabelTh}</div>
              </td>
              <td>{a.detail}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                {rows.length === 0 ? "No audit records for this date — either nothing happened, or it's past the retention window." : 'No actions match your search.'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {filtered.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
    </>
  )
}
