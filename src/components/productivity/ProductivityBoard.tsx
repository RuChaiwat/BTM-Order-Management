'use client'

import { useMemo, useState } from 'react'
import { formatDate } from '@/lib/formatDate'

interface PickerRow {
  user_id: string
  name: string
  pcsPerHour: number | null
  completed: number
  shortRate: number | null
  slaPct: number | null
}

interface LeaderboardRow {
  user_id: string
  name: string
  pcsPerHour: number
  completed: number
}

interface ReasonRow {
  code: string
  label: string
  zone: string
  count: number
  shortPieces: number
}

type PickerSortKey = 'name' | 'pcsPerHour' | 'completed' | 'slaPct' | 'shortRate'
type ReasonSortKey = 'label' | 'zone' | 'count' | 'shortPieces'

function sortRows<T, K extends string>(rows: T[], key: K, dir: 'asc' | 'desc', pick: (row: T, key: K) => string | number | null): T[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = pick(a, key)
    const bv = pick(b, key)
    if (av === null && bv === null) return 0
    if (av === null) return 1
    if (bv === null) return -1
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

function SortHeader<K extends string>({ label, sortKey, sort, onSort }: { label: string; sortKey: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (key: K) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

function Leaderboard({ title, subtitle, rows, valueColor, emptyText }: { title: string; subtitle: string; rows: LeaderboardRow[]; valueColor: string; emptyText: string }) {
  return (
    <div className="card" style={{ minHeight: 0 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">{title}</span>
        <span className="card-subtitle">{subtitle}</span>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>#</th>
            <th>PICKER</th>
            <th>PCS / HR</th>
            <th>ORDERS</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.user_id}>
              <td>{i + 1}</td>
              <td style={{ fontWeight: 700 }}>
                {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.user_id})</span>
              </td>
              <td style={{ fontWeight: 700, color: valueColor }}>{p.pcsPerHour.toLocaleString()}</td>
              <td>{p.completed}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

export function ProductivityBoard({
  pickerRows,
  reasonBreakdown,
  topAboveTarget,
  bottomPerformers,
  targetPcsPerHour,
  date,
  warehouseCode,
}: {
  pickerRows: PickerRow[]
  reasonBreakdown: ReasonRow[]
  topAboveTarget: LeaderboardRow[]
  bottomPerformers: LeaderboardRow[]
  targetPcsPerHour: number
  date: string
  warehouseCode: string
}) {
  const [pickerSort, setPickerSort] = useState<{ key: PickerSortKey; dir: 'asc' | 'desc' }>({ key: 'pcsPerHour', dir: 'desc' })
  const [reasonSort, setReasonSort] = useState<{ key: ReasonSortKey; dir: 'asc' | 'desc' }>({ key: 'shortPieces', dir: 'desc' })

  function togglePickerSort(key: PickerSortKey) {
    setPickerSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
  }
  function toggleReasonSort(key: ReasonSortKey) {
    setReasonSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'label' || key === 'zone' ? 'asc' : 'desc' }))
  }

  const sortedPickers = useMemo(
    () =>
      sortRows(pickerRows, pickerSort.key, pickerSort.dir, (row, key) => {
        if (key === 'name') return row.name
        return row[key]
      }),
    [pickerRows, pickerSort],
  )
  const sortedReasons = useMemo(
    () =>
      sortRows(reasonBreakdown, reasonSort.key, reasonSort.dir, (row, key) => {
        if (key === 'label') return row.label
        if (key === 'zone') return row.zone
        return row[key]
      }),
    [reasonBreakdown, reasonSort],
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, flex: 1, minHeight: 0 }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Leaderboard
          title="Top 10 Above Target"
          subtitle={`${formatDate(date)} · > ${targetPcsPerHour.toLocaleString()} pcs/hr`}
          rows={topAboveTarget}
          valueColor="#16A34A"
          emptyText="No picker exceeded target on this date."
        />
        <Leaderboard
          title="Bottom 10 Pickers"
          subtitle={`${formatDate(date)} · lowest pcs/hr among pickers who worked`}
          rows={bottomPerformers}
          valueColor="#DC2626"
          emptyText="No completions on this date yet."
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-header" style={{ marginBottom: 10 }}>
            <span className="card-title">Picker Productivity</span>
            <span className="card-subtitle">ผลิตภาพผู้หยิบสินค้า · {formatDate(date)} · click a column to sort</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <SortHeader label="PICKER" sortKey="name" sort={pickerSort} onSort={togglePickerSort} />
                <SortHeader label="PCS / HR" sortKey="pcsPerHour" sort={pickerSort} onSort={togglePickerSort} />
                <SortHeader label="ORDERS COMPLETED" sortKey="completed" sort={pickerSort} onSort={togglePickerSort} />
                <SortHeader label="SLA %" sortKey="slaPct" sort={pickerSort} onSort={togglePickerSort} />
                <SortHeader label="SHORT PICK RATE" sortKey="shortRate" sort={pickerSort} onSort={togglePickerSort} />
              </tr>
            </thead>
            <tbody>
              {sortedPickers.map((p, i) => (
                <tr key={p.user_id}>
                  <td>{i + 1}</td>
                  <td style={{ fontWeight: 700 }}>
                    {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.user_id})</span>
                  </td>
                  <td style={{ fontWeight: p.pcsPerHour ? 700 : 400, color: p.pcsPerHour ? undefined : '#6B7280' }}>{p.pcsPerHour ?? '—'}</td>
                  <td>{p.completed}</td>
                  <td>{p.slaPct !== null ? `${p.slaPct}%` : '—'}</td>
                  <td>{p.shortRate !== null ? `${p.shortRate}%` : '—'}</td>
                </tr>
              ))}
              {sortedPickers.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                    No active pickers found for {warehouseCode}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-header" style={{ marginBottom: 10 }}>
            <span className="card-title">Short Pick Reasons</span>
            <span className="card-subtitle">สาเหตุการหยิบขาด · click a column to sort</span>
          </div>
          <table className="table">
            <thead>
              <tr>
                <SortHeader label="REASON" sortKey="label" sort={reasonSort} onSort={toggleReasonSort} />
                <SortHeader label="ZONE" sortKey="zone" sort={reasonSort} onSort={toggleReasonSort} />
                <SortHeader label="OCCURRENCES" sortKey="count" sort={reasonSort} onSort={toggleReasonSort} />
                <SortHeader label="PIECES SHORT" sortKey="shortPieces" sort={reasonSort} onSort={toggleReasonSort} />
              </tr>
            </thead>
            <tbody>
              {sortedReasons.map((r) => (
                <tr key={`${r.code}__${r.zone}`}>
                  <td>{r.label}</td>
                  <td>{r.zone}</td>
                  <td>{r.count}</td>
                  <td style={{ fontWeight: 700, color: '#F59E0B' }}>{r.shortPieces}</td>
                </tr>
              ))}
              {sortedReasons.length === 0 && (
                <tr>
                  <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                    No short picks on this date.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
