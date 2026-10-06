'use client'

import { useMemo, useState } from 'react'
import { productivityMeta } from '../../lib/pickerProductivity'

interface PickerProductivity {
  pickerId: string
  name: string
  pcsPerHour: number
  level: string
}

const PAGE_SIZE = 20

type SortKey = 'name' | 'pcsPerHour'

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

export function PickerProductivityTable({ pickers, targetPcsPerHour }: { pickers: PickerProductivity[]; targetPcsPerHour: number }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'pcsPerHour', dir: 'desc' })
  const [page, setPage] = useState(1)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'name' ? 'asc' : 'desc' }))
    setPage(1)
  }

  const sorted = useMemo(() => {
    const copy = [...pickers]
    copy.sort((a, b) => {
      const cmp = sort.key === 'name' ? a.name.localeCompare(b.name) : a.pcsPerHour - b.pcsPerHour
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
            <SortHeader label="PCS/HR" sortKey="pcsPerHour" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((p) => {
            const meta = productivityMeta(p.level)
            return (
              <tr key={p.pickerId}>
                <td style={{ fontWeight: 700 }}>{p.name}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        height: 10,
                        borderRadius: 5,
                        background: meta.color,
                        width: Math.max(8, Math.min(100, (p.pcsPerHour / targetPcsPerHour) * 100)),
                      }}
                    />
                    <span style={{ fontWeight: 700 }}>{p.pcsPerHour.toLocaleString()}</span>
                  </div>
                </td>
              </tr>
            )
          })}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={2} style={{ color: 'var(--color-text-secondary)' }}>
                No completed picks yet today.
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
