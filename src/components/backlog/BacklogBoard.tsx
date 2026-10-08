'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDate } from '../../lib/formatDate'
import { Pagination } from '@/components/Pagination'

interface BacklogRow {
  order_id: string
  order_no: string
  store_code: string
  status: string
  original_order_date: string
  planned_pieces: number
  zones: string[]
  pickerId: string | null
  pickerName: string
  backlogType: 'picking' | 'verification' | 'both'
  alert?: { time_alert: string | null; elapsed_minutes: number } | null
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'picking', label: 'Picking Pending' },
  { key: 'verification', label: 'Verification Pending' },
] as const

const PAGE_SIZE = 20

type SortKey = 'order_no' | 'store_code' | 'original_order_date' | 'zones' | 'pickerName' | 'backlogType' | 'elapsed' | 'alert'

function sortValue(r: BacklogRow, key: SortKey): string | number {
  switch (key) {
    case 'order_no':
      return r.order_no
    case 'store_code':
      return r.store_code
    case 'original_order_date':
      return r.original_order_date
    case 'zones':
      return r.zones.join(', ')
    case 'pickerName':
      return r.pickerName
    case 'backlogType':
      return r.backlogType
    case 'elapsed':
      return r.alert?.elapsed_minutes ?? 0
    case 'alert':
      return r.alert?.time_alert ?? ''
  }
}

function sortRows(rows: BacklogRow[], key: SortKey, dir: 'asc' | 'desc'): BacklogRow[] {
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

/** Where clicking an order's number should send the user to actually act on its pending step --
 * Picking goes to Pick Completion pre-loaded with the assigned picker's queue (same scan-driven
 * flow, just skipping the manual scan since we already know who it's assigned to); Verification
 * goes straight to Admin Verification with that order pre-selected. An order flagged as both picks
 * Picking first since that's the step actually blocking Verification. An unassigned order (no
 * picker on file yet) has no Pick Completion queue to jump into, so its number stays plain text. */
function orderHref(r: BacklogRow): string | null {
  if (r.backlogType === 'verification') return `/verification?order_id=${encodeURIComponent(r.order_id)}`
  if (!r.pickerId) return null
  const params = new URLSearchParams({ order_id: r.order_id, picker_id: r.pickerId })
  return `/pick-completion?${params.toString()}`
}

export function BacklogBoard({ rows }: { rows: BacklogRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'elapsed', dir: 'desc' })
  const [page, setPage] = useState(1)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'elapsed' ? 'desc' : 'asc' }))
    setPage(1)
  }

  function selectFilter(key: (typeof FILTERS)[number]['key']) {
    setFilter(key)
    setPage(1)
  }

  const filtered = rows.filter((r) => filter === 'all' || r.backlogType === filter || r.backlogType === 'both')
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <div className="card" style={{ flex: 1 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Pending Action</span>
        <span className="card-subtitle">รายการที่ต้องดำเนินการ · click a column to sort</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => selectFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '13%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '20%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="ORDER NO." sortKey="order_no" sort={sort} onSort={toggleSort} />
            <SortHeader label="STORE" sortKey="store_code" sort={sort} onSort={toggleSort} />
            <SortHeader
              label={
                <>
                  ORDER
                  <br />
                  DATE
                </>
              }
              sortKey="original_order_date"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader label="ZONES" sortKey="zones" sort={sort} onSort={toggleSort} />
            <SortHeader label="PICKER" sortKey="pickerName" sort={sort} onSort={toggleSort} />
            <SortHeader
              label={
                <>
                  PENDING
                  <br />
                  TYPE
                </>
              }
              sortKey="backlogType"
              sort={sort}
              onSort={toggleSort}
            />
            <SortHeader label="ELAPSED" sortKey="elapsed" sort={sort} onSort={toggleSort} />
            <SortHeader label="ALERT" sortKey="alert" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => {
            const href = orderHref(r)
            return (
              <tr key={r.order_id}>
                <td className="link">{href ? <Link href={href}>{r.order_no}</Link> : r.order_no}</td>
                <td>{r.store_code}</td>
                <td>{formatDate(r.original_order_date)}</td>
                <td style={{ overflowWrap: 'break-word' }}>{r.zones.join(', ') || '—'}</td>
                <td style={{ overflowWrap: 'break-word' }}>{r.pickerName}</td>
                <td>
                  {r.backlogType === 'both' ? (
                    <>
                      <span className="badge badge-warning">Picking</span> <span className="badge badge-info">Verification</span>
                    </>
                  ) : r.backlogType === 'picking' ? (
                    <span className="badge badge-warning">Picking</span>
                  ) : (
                    <span className="badge badge-info">Verification</span>
                  )}
                </td>
                <td>{r.alert ? `${Math.round(r.alert.elapsed_minutes)} min` : '—'}</td>
                <td>
                  {r.alert?.time_alert ? (
                    <span className={`badge badge-${r.alert.time_alert === 'critical' ? 'danger' : 'warning'}`}>{r.alert.time_alert}</span>
                  ) : (
                    <span style={{ color: '#9CA3AF' }}>—</span>
                  )}
                </td>
              </tr>
            )
          })}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
                No pending actions — nice work.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
    </div>
  )
}
