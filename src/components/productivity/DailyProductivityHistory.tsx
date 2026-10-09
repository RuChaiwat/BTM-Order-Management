'use client'

import { useMemo, useState } from 'react'
import { formatDate } from '@/lib/formatDate'
import { Pagination } from '@/components/Pagination'
import { ExportExcelButton } from '@/components/ExportExcelButton'

interface DailyRow {
  date: string
  completedOrders: number
  totalPieces: number
  avgPcsPerHour: number | null
  slaPct: number | null
  shortPieces: number
  shortRatePct: number | null
}

const PAGE_SIZE = 20

type SortKey = 'date' | 'completedOrders' | 'totalPieces' | 'avgPcsPerHour' | 'slaPct' | 'shortPieces' | 'shortRatePct'

function sortRows(rows: DailyRow[], key: SortKey, dir: 'asc' | 'desc'): DailyRow[] {
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

function SortHeader({ label, sortKey, sort, onSort }: { label: React.ReactNode; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

/** Month-to-date rollup, every picker combined, one row per day -- deliberately independent of
 * the date picker up top (always "this calendar month so far"), with today's own row left out
 * since its numbers are already the KPI cards above. Highlighting the row that matches the
 * selected date is the only place this table reacts to that picker at all; selecting today
 * highlights nothing since today was never a row here to begin with (see getMonthlyProductivityHistory). */
export function DailyProductivityHistory({ rows, selectedDate }: { rows: DailyRow[]; selectedDate: string }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const [page, setPage] = useState(1)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'date' ? 'desc' : 'desc' }))
    setPage(1)
  }

  const sorted = useMemo(() => sortRows(rows, sort.key, sort.dir), [rows, sort])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Daily Productivity</span>
        <span className="card-subtitle">ประสิทธิผลรายวัน · เดือนนี้ · click a column to sort</span>
        <ExportExcelButton href="/api/productivity/daily-export" style={{ marginLeft: 'auto' }} />
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '14%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="DATE" sortKey="date" sort={sort} onSort={toggleSort} />
            <SortHeader
              label={
                <>
                  ORDERS
                  <br />
                  COMPLETED
                </>
              }
              sortKey="completedOrders"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader
              label={
                <>
                  PIECES
                  <br />
                  COMPLETED
                </>
              }
              sortKey="totalPieces"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader
              label={
                <>
                  AVG
                  <br />
                  PCS/HOUR
                </>
              }
              sortKey="avgPcsPerHour"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader
              label={
                <>
                  SLA
                  <br />
                  COMPLIANCE
                </>
              }
              sortKey="slaPct"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader
              label={
                <>
                  SHORT
                  <br />
                  PICK (PCS)
                </>
              }
              sortKey="shortPieces"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader
              label={
                <>
                  SHORT PICK
                  <br />
                  RATE
                </>
              }
              sortKey="shortRatePct"
              sort={sort}
              onSort={toggleSort}
            />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={r.date} style={r.date === selectedDate ? { background: 'var(--color-surface-muted)', boxShadow: 'inset 2px 0 0 var(--color-primary)' } : undefined}>
              <td style={{ fontWeight: 700 }}>{formatDate(r.date)}</td>
              <td>{r.completedOrders.toLocaleString()}</td>
              <td>{r.totalPieces.toLocaleString()}</td>
              <td style={{ fontWeight: r.avgPcsPerHour ? 700 : 400, color: r.avgPcsPerHour ? undefined : '#6B7280' }}>{r.avgPcsPerHour ?? '—'}</td>
              <td>{r.slaPct !== null ? `${r.slaPct}%` : '—'}</td>
              <td>{r.shortPieces.toLocaleString()}</td>
              <td>{r.shortRatePct !== null ? `${r.shortRatePct}%` : '—'}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                No completions yet this month.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
    </div>
  )
}
