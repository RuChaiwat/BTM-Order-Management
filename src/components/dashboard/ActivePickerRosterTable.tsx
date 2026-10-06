'use client'

import { useMemo, useState } from 'react'

interface ActivePicker {
  pickerId: string
  name: string
  orders: number
  pieces: number
  elapsedMinutes: number
  timeAlert: 'warning' | 'overdue' | 'critical' | null
}

const PAGE_SIZE = 20
// Same red/yellow/green convention as Zone Status and Zone Dashboard's own risk badges --
// 'warning' reads as the same caution yellow as 'overdue' here, one tier short of the full
// Warning/Overdue/Critical breakdown, to keep a plain 3-color read at a glance.
const ALERT_COLOR: Record<'critical' | 'overdue' | 'warning', string> = { critical: '#DC2626', overdue: '#F59E0B', warning: '#F59E0B' }
const ALERT_RANK: Record<string, number> = { critical: 3, overdue: 2, warning: 1 }

type SortKey = 'name' | 'timeAlert' | 'elapsedMinutes' | 'pieces' | 'orders'

function sortValue(p: ActivePicker, key: SortKey): string | number {
  switch (key) {
    case 'name':
      return p.name
    case 'timeAlert':
      return ALERT_RANK[p.timeAlert ?? ''] ?? 0
    case 'elapsedMinutes':
      return p.elapsedMinutes
    case 'pieces':
      return p.pieces
    case 'orders':
      return p.orders
  }
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

export function ActivePickerRosterTable({ pickers }: { pickers: ActivePicker[] }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'elapsedMinutes', dir: 'desc' })
  const [page, setPage] = useState(1)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
    setPage(1)
  }

  const sorted = useMemo(() => {
    const copy = [...pickers]
    copy.sort((a, b) => {
      const av = sortValue(a, sort.key)
      const bv = sortValue(b, sort.key)
      const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [pickers, sort])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <>
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="PICKER" sortKey="name" sort={sort} onSort={toggleSort} />
            <SortHeader label="STATUS" sortKey="timeAlert" sort={sort} onSort={toggleSort} />
            <SortHeader label="TIME" sortKey="elapsedMinutes" sort={sort} onSort={toggleSort} />
            <SortHeader label="PIECES" sortKey="pieces" sort={sort} onSort={toggleSort} />
            <SortHeader label="ORDERS" sortKey="orders" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((p) => (
            <tr key={p.pickerId}>
              <td style={{ fontWeight: 700 }}>
                {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.pickerId})</span>
              </td>
              <td>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: p.timeAlert ? ALERT_COLOR[p.timeAlert] : '#16A34A', flex: '0 0 auto' }} />
                  {p.timeAlert ?? 'On track'}
                </span>
              </td>
              <td>{p.elapsedMinutes} min</td>
              <td style={{ fontWeight: 700 }}>{p.pieces.toLocaleString()}</td>
              <td>{p.orders}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                No pickers actively working right now.
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
