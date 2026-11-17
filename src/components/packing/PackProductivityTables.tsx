'use client'

import { useMemo, useState } from 'react'
import { Pagination } from '@/components/Pagination'
import type { PackerProductivityRow } from '../../lib/queries/packing'

interface StationRow {
  station_code: string
  orders: number
  pieces: number
  seconds: number
  pcsPerHour: number | null
  issuesReported: number
}

type Sort<K> = { key: K; dir: 'asc' | 'desc' }

function dur(sec: number | null) {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(sec % 60).padStart(2, '0')}s`
}

/** Click a column header to sort by it; click again to flip the direction. */
function SortHeader<K extends string>({ label, sortKey, sort, onSort }: { label: React.ReactNode; sortKey: K; sort: Sort<K>; onSort: (key: K) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)} title="กดเพื่อเรียงลำดับ">
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

function useSort<K extends string>(initial: Sort<K>, textKeys: K[]) {
  const [sort, setSort] = useState<Sort<K>>(initial)
  const toggle = (key: K) => setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: textKeys.includes(key) ? 'asc' : 'desc' }))
  return [sort, toggle] as const
}

/** Numbers sort numerically, blanks (—) always last; text sorts naturally (PK-2 before PK-10). */
function compare(a: unknown, b: unknown, dir: 'asc' | 'desc') {
  if (a === null || a === undefined) return b === null || b === undefined ? 0 : 1
  if (b === null || b === undefined) return -1
  const cmp = typeof a === 'number' && typeof b === 'number' ? a - b : String(a).localeCompare(String(b), 'th', { numeric: true })
  return dir === 'asc' ? cmp : -cmp
}

const PACKER_PAGE = 20
const STATION_PAGE = 10

type PackerKey = 'name' | 'orders' | 'pieces' | 'seconds' | 'pcsPerHour' | 'avgSecondsPerOrder' | 'issuesReported'

export function PackerProductivityTable({ packers, target }: { packers: PackerProductivityRow[]; target: number }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sort, toggle] = useSort<PackerKey>({ key: 'pcsPerHour', dir: 'desc' }, ['name'])
  const pctOfTarget = (rate: number | null) => (rate !== null && target > 0 ? Math.round((rate / target) * 100) : null)
  const pctColor = (pct: number | null) => (pct === null ? undefined : pct >= 100 ? 'var(--color-success-dark)' : pct >= 80 ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)')

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    // A suggestion fills "ID · name"; match on either part so typing a few letters is enough.
    const terms = q.split('·').map((t) => t.trim()).filter(Boolean)
    const hit = (p: PackerProductivityRow) => terms.every((t) => p.picker_id.toLowerCase().includes(t) || p.name.toLowerCase().includes(t))
    return packers.filter((p) => !terms.length || hit(p)).sort((a, b) => compare(a[sort.key], b[sort.key], sort.dir))
  }, [packers, query, sort])
  const totalPages = Math.max(1, Math.ceil(rows.length / PACKER_PAGE))
  const current = Math.min(page, totalPages)
  const pageRows = rows.slice((current - 1) * PACKER_PAGE, current * PACKER_PAGE)
  const onSort = (k: PackerKey) => {
    toggle(k)
    setPage(1)
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
        <input
          className="field-input"
          list="packer-suggest"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setPage(1)
          }}
          placeholder="ค้นหารหัส หรือชื่อพนักงาน"
          style={{ border: '1px solid var(--color-border)', width: 320, maxWidth: '100%' }}
          autoComplete="off"
        />
        <datalist id="packer-suggest">
          {packers.map((p) => (
            <option key={p.picker_id} value={`${p.picker_id} · ${p.name}`} />
          ))}
        </datalist>
        {query && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setQuery('')}>
            ล้าง
          </button>
        )}
        <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
          {rows.length.toLocaleString()} / {packers.length.toLocaleString()} คน
        </span>
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '24%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '12%' }} />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="PACKER" sortKey="name" sort={sort} onSort={onSort} />
            <SortHeader label="ORDERS" sortKey="orders" sort={sort} onSort={onSort} />
            <SortHeader label="PIECES" sortKey="pieces" sort={sort} onSort={onSort} />
            <SortHeader label={<>PACK<br />TIME</>} sortKey="seconds" sort={sort} onSort={onSort} />
            <SortHeader label={<>PCS<br />/ HOUR</>} sortKey="pcsPerHour" sort={sort} onSort={onSort} />
            <SortHeader label={<>% OF<br />TARGET</>} sortKey="pcsPerHour" sort={sort} onSort={onSort} />
            <SortHeader label={<>AVG<br />/ ORDER</>} sortKey="avgSecondsPerOrder" sort={sort} onSort={onSort} />
            <SortHeader label="ISSUES" sortKey="issuesReported" sort={sort} onSort={onSort} />
            <th>STATIONS</th>
          </tr>
        </thead>
        <tbody>
          {pageRows.map((p) => {
            const pct = pctOfTarget(p.pcsPerHour)
            return (
              <tr key={p.picker_id}>
                <td style={{ overflowWrap: 'break-word' }}>
                  {p.name}
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{p.picker_id}</div>
                </td>
                <td>{p.orders.toLocaleString()}</td>
                <td style={{ fontWeight: 700 }}>{p.pieces.toLocaleString()}</td>
                <td>{dur(p.seconds)}</td>
                <td style={{ fontWeight: 700 }}>{p.pcsPerHour?.toLocaleString() ?? '—'}</td>
                <td style={{ fontWeight: 700, color: pctColor(pct) }}>{pct !== null ? `${pct}%` : '—'}</td>
                <td>{dur(p.avgSecondsPerOrder)}</td>
                <td style={{ color: p.issuesReported ? 'var(--color-danger)' : undefined }}>
                  {p.issuesReported}
                  {p.issuePieces > 0 && <div style={{ fontSize: 11 }}>หัก {p.issuePieces} ชิ้น</div>}
                </td>
                <td style={{ fontSize: 12, overflowWrap: 'break-word' }}>{p.stations.join(', ')}</td>
              </tr>
            )
          })}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={9} style={{ color: 'var(--color-text-secondary)' }}>
                {packers.length ? 'ไม่พบพนักงานที่ค้นหา' : 'ไม่มีงานแพ็กที่ปิดในวันนี้'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > PACKER_PAGE && <Pagination page={current} totalPages={totalPages} onChange={setPage} />}
    </>
  )
}

type StationKey = 'station_code' | 'orders' | 'pieces' | 'seconds' | 'pcsPerHour' | 'issuesReported'

export function StationProductivityTable({ stations }: { stations: StationRow[] }) {
  const [page, setPage] = useState(1)
  const [sort, toggle] = useSort<StationKey>({ key: 'station_code', dir: 'asc' }, ['station_code'])
  const rows = useMemo(() => [...stations].sort((a, b) => compare(a[sort.key], b[sort.key], sort.dir)), [stations, sort])
  const totalPages = Math.max(1, Math.ceil(rows.length / STATION_PAGE))
  const current = Math.min(page, totalPages)
  const pageRows = rows.slice((current - 1) * STATION_PAGE, current * STATION_PAGE)
  const onSort = (k: StationKey) => {
    toggle(k)
    setPage(1)
  }

  return (
    <>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '15%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '18%' }} />
          <col style={{ width: '16%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <SortHeader label="STATION" sortKey="station_code" sort={sort} onSort={onSort} />
            <SortHeader label="ORDERS" sortKey="orders" sort={sort} onSort={onSort} />
            <SortHeader label="PIECES" sortKey="pieces" sort={sort} onSort={onSort} />
            <SortHeader label={<>PACK<br />TIME</>} sortKey="seconds" sort={sort} onSort={onSort} />
            <SortHeader label={<>PCS<br />/ HOUR</>} sortKey="pcsPerHour" sort={sort} onSort={onSort} />
            <SortHeader label="ISSUES" sortKey="issuesReported" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((s) => (
            <tr key={s.station_code}>
              <td style={{ fontWeight: 700 }}>{s.station_code}</td>
              <td>{s.orders.toLocaleString()}</td>
              <td>{s.pieces.toLocaleString()}</td>
              <td>{dur(s.seconds)}</td>
              <td style={{ fontWeight: 700 }}>{s.pcsPerHour?.toLocaleString() ?? '—'}</td>
              <td style={{ color: s.issuesReported ? 'var(--color-danger)' : undefined }}>{s.issuesReported}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                —
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {rows.length > STATION_PAGE && <Pagination page={current} totalPages={totalPages} onChange={setPage} />}
    </>
  )
}
