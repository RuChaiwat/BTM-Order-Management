'use client'

import { useMemo, useState } from 'react'
import { Pagination } from '@/components/Pagination'
import { formatDate } from '@/lib/formatDate'
import type { DailyPackingSummary, PackerProductivityRow } from '../../lib/queries/packing'

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

const pctColor = (rate: number | null, target: number) => {
  if (rate === null || target <= 0) return undefined
  const pct = (rate / target) * 100
  return pct >= 100 ? 'var(--color-success-dark)' : pct >= 80 ? 'var(--color-warning-dark)' : 'var(--color-danger-dark)'
}

const PACKER_PAGE = 20
const DAILY_PAGE = 20

type PackerKey = 'name' | 'employmentType' | 'orders' | 'pieces' | 'pcsPerHour' | 'avgSecondsPerOrder' | 'issuesReported'

/** Same layout as Picking Productivity's Picker Productivity table, plus the search box. */
export function PackerProductivityTable({ packers, target }: { packers: PackerProductivityRow[]; target: number }) {
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [sort, toggle] = useSort<PackerKey>({ key: 'pcsPerHour', dir: 'desc' }, ['name', 'employmentType'])

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
      <PeopleSearch
        id="packer-suggest"
        query={query}
        onChange={(q) => {
          setQuery(q)
          setPage(1)
        }}
        options={packers.map((p) => `${p.picker_id} · ${p.name}`)}
        shown={rows.length}
        total={packers.length}
      />
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '4%' }} />
          <col style={{ width: '24%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <SortHeader label="PACKER" sortKey="name" sort={sort} onSort={onSort} />
            <SortHeader label="TYPE" sortKey="employmentType" sort={sort} onSort={onSort} />
            <SortHeader label="PCS / HR" sortKey="pcsPerHour" sort={sort} onSort={onSort} />
            <SortHeader label={<>ORDERS<br />COMPLETED</>} sortKey="orders" sort={sort} onSort={onSort} />
            <SortHeader label={<>PIECES<br />COMPLETED</>} sortKey="pieces" sort={sort} onSort={onSort} />
            <SortHeader label={<>AVG<br />/ ORDER</>} sortKey="avgSecondsPerOrder" sort={sort} onSort={onSort} />
            <SortHeader label="ISSUES" sortKey="issuesReported" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((p, i) => (
            <tr key={p.picker_id}>
              <td>{(current - 1) * PACKER_PAGE + i + 1}</td>
              <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>
                {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.picker_id})</span>
              </td>
              <td style={{ overflowWrap: 'break-word' }}>{p.employmentType ?? <span style={{ color: '#9CA3AF' }}>—</span>}</td>
              <td style={{ fontWeight: 700, color: pctColor(p.pcsPerHour, target) }}>{p.pcsPerHour?.toLocaleString() ?? '—'}</td>
              <td>{p.orders.toLocaleString()}</td>
              <td>{p.pieces.toLocaleString()}</td>
              <td>{dur(p.avgSecondsPerOrder)}</td>
              <td style={{ color: p.issuesReported ? 'var(--color-danger)' : undefined }}>
                {p.issuesReported}
                {p.issuePieces > 0 && <div style={{ fontSize: 11 }}>หัก {p.issuePieces} ชิ้น</div>}
              </td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
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

/** Search box with name suggestions, shared by Picker and Packer productivity tables. */
export function PeopleSearch({ id, query, onChange, options, shown, total }: { id: string; query: string; onChange: (q: string) => void; options: string[]; shown: number; total: number }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 10, flexWrap: 'wrap' }}>
      <input
        className="field-input"
        list={id}
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="ค้นหารหัส หรือชื่อพนักงาน"
        style={{ border: '1px solid var(--color-border)', width: 320, maxWidth: '100%' }}
        autoComplete="off"
      />
      <datalist id={id}>
        {options.map((o) => (
          <option key={o} value={o} />
        ))}
      </datalist>
      {query && (
        <button type="button" className="btn btn-secondary btn-sm" onClick={() => onChange('')}>
          ล้าง
        </button>
      )}
      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
        {shown.toLocaleString()} / {total.toLocaleString()} คน
      </span>
    </div>
  )
}

/** Top 10 / Bottom 10 packers -- same card as Picking Productivity's leaderboards. */
export function PackLeaderboard({ title, subtitle, rows, valueColor, emptyText }: { title: string; subtitle: string; rows: PackerProductivityRow[]; valueColor: string; emptyText: string }) {
  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">{title}</span>
        <span className="card-subtitle">{subtitle}</span>
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '6%' }} />
          <col style={{ width: '38%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>PACKER</th>
            <th>PCS / HR</th>
            <th>ORDERS</th>
            <th>PIECES</th>
            <th>AVG / ORDER</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p, i) => (
            <tr key={p.picker_id}>
              <td>{i + 1}</td>
              <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>
                {p.name} <span style={{ fontWeight: 400, color: '#6B7280' }}>({p.picker_id})</span>
                {p.employmentType && <div style={{ fontSize: 11, fontWeight: 400, color: '#6B7280' }}>{p.employmentType}</div>}
              </td>
              <td style={{ fontWeight: 700, color: valueColor }}>{p.pcsPerHour?.toLocaleString() ?? '—'}</td>
              <td>{p.orders.toLocaleString()}</td>
              <td>{p.pieces.toLocaleString()}</td>
              <td>{dur(p.avgSecondsPerOrder)}</td>
            </tr>
          ))}
          {rows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                {emptyText}
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

type DailyKey = 'date' | 'orders' | 'pieces' | 'pcsPerHour' | 'issues' | 'issuePieces'

/** Month-to-date daily rollup -- same as Picking Productivity's Daily Productivity table. */
export function DailyPackingHistory({ rows, selectedDate, target }: { rows: DailyPackingSummary[]; selectedDate: string; target: number }) {
  const [page, setPage] = useState(1)
  const [sort, toggle] = useSort<DailyKey>({ key: 'date', dir: 'desc' }, [])
  const sorted = useMemo(() => [...rows].sort((a, b) => compare(a[sort.key], b[sort.key], sort.dir)), [rows, sort])
  const totalPages = Math.max(1, Math.ceil(sorted.length / DAILY_PAGE))
  const current = Math.min(page, totalPages)
  const pageRows = sorted.slice((current - 1) * DAILY_PAGE, current * DAILY_PAGE)
  const onSort = (k: DailyKey) => {
    toggle(k)
    setPage(1)
  }

  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Daily Productivity</span>
        <span className="card-subtitle">ประสิทธิผลรายวัน · เดือนนี้</span>
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <thead>
          <tr>
            <SortHeader label="DATE" sortKey="date" sort={sort} onSort={onSort} />
            <SortHeader label={<>ORDERS<br />COMPLETED</>} sortKey="orders" sort={sort} onSort={onSort} />
            <SortHeader label={<>PIECES<br />COMPLETED</>} sortKey="pieces" sort={sort} onSort={onSort} />
            <SortHeader label={<>AVG<br />PCS/HOUR</>} sortKey="pcsPerHour" sort={sort} onSort={onSort} />
            <SortHeader label={<>ISSUES<br />(ORDER)</>} sortKey="issues" sort={sort} onSort={onSort} />
            <SortHeader label={<>ISSUE<br />(PCS)</>} sortKey="issuePieces" sort={sort} onSort={onSort} />
          </tr>
        </thead>
        <tbody>
          {pageRows.map((r) => (
            <tr key={r.date} style={r.date === selectedDate ? { background: 'var(--color-surface-muted)', boxShadow: 'inset 2px 0 0 var(--color-primary)' } : undefined}>
              <td style={{ fontWeight: 700 }}>{formatDate(r.date)}</td>
              <td>{r.orders.toLocaleString()}</td>
              <td>{r.pieces.toLocaleString()}</td>
              <td style={{ fontWeight: 700, color: pctColor(r.pcsPerHour, target) }}>{r.pcsPerHour?.toLocaleString() ?? '—'}</td>
              <td style={{ color: r.issues ? 'var(--color-danger)' : undefined }}>{r.issues.toLocaleString()}</td>
              <td>{r.issuePieces.toLocaleString()}</td>
            </tr>
          ))}
          {pageRows.length === 0 && (
            <tr>
              <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                ยังไม่มีงานแพ็กที่เสร็จในเดือนนี้
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sorted.length > DAILY_PAGE && <Pagination page={current} totalPages={totalPages} onChange={setPage} />}
    </div>
  )
}
