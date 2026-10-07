'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDate, formatDateTime } from '@/lib/formatDate'
import { Pagination } from '@/components/Pagination'

interface ExportJob {
  id: string
  status: string
  period_start: string | null
  period_end: string | null
  row_count: number | null
  target_ref: string | null
  finished_at: string | null
  error_detail: string | null
}

interface PurgeRow {
  id: string
  covered_period_start: string
  table_name: string
  rows_purged: number
  result: string
  created_at: string
}

const PAGE_SIZE = 20

type ExportSortKey = 'period_start' | 'status' | 'row_count' | 'finished_at'
type PurgeSortKey = 'covered_period_start' | 'table_name' | 'rows_purged' | 'result' | 'created_at'

function sortRows<T, K extends string>(rows: T[], key: K, dir: 'asc' | 'desc', getter: (row: T, key: K) => string | number | null): T[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = getter(a, key)
    const bv = getter(b, key)
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

export function HousekeepingPanel({ exportJobs, purgeLog }: { exportJobs: ExportJob[]; purgeLog: PurgeRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'export' | 'purge' | null>(null)

  const [exportSort, setExportSort] = useState<{ key: ExportSortKey; dir: 'asc' | 'desc' }>({ key: 'finished_at', dir: 'desc' })
  const [exportPage, setExportPage] = useState(1)
  const [purgeSort, setPurgeSort] = useState<{ key: PurgeSortKey; dir: 'asc' | 'desc' }>({ key: 'created_at', dir: 'desc' })
  const [purgePage, setPurgePage] = useState(1)

  async function trigger(kind: 'export' | 'purge') {
    setBusy(kind)
    await fetch(kind === 'export' ? '/api/cron/weekly-export' : '/api/cron/purge')
    setBusy(null)
    router.refresh()
  }

  function toggleExportSort(key: ExportSortKey) {
    setExportSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'status' ? 'asc' : 'desc' }))
    setExportPage(1)
  }
  function togglePurgeSort(key: PurgeSortKey) {
    setPurgeSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'table_name' || key === 'result' ? 'asc' : 'desc' }))
    setPurgePage(1)
  }

  const sortedExportJobs = useMemo(
    () =>
      sortRows(exportJobs, exportSort.key, exportSort.dir, (j, key) =>
        key === 'period_start' ? j.period_start : key === 'status' ? j.status : key === 'row_count' ? j.row_count : j.finished_at,
      ),
    [exportJobs, exportSort],
  )
  const exportTotalPages = Math.max(1, Math.ceil(sortedExportJobs.length / PAGE_SIZE))
  const exportPageRows = sortedExportJobs.slice((exportPage - 1) * PAGE_SIZE, exportPage * PAGE_SIZE)

  const sortedPurgeLog = useMemo(
    () =>
      sortRows(purgeLog, purgeSort.key, purgeSort.dir, (p, key) =>
        key === 'covered_period_start'
          ? p.covered_period_start
          : key === 'table_name'
            ? p.table_name
            : key === 'rows_purged'
              ? p.rows_purged
              : key === 'result'
                ? p.result
                : p.created_at,
      ),
    [purgeLog, purgeSort],
  )
  const purgeTotalPages = Math.max(1, Math.ceil(sortedPurgeLog.length / PAGE_SIZE))
  const purgePageRows = sortedPurgeLog.slice((purgePage - 1) * PAGE_SIZE, purgePage * PAGE_SIZE)

  return (
    <div className="card">
      <div className="card-title">Housekeeping</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        Export รายสัปดาห์ + ลบข้อมูลตามระยะเวลาเก็บ · §20.1/§20.2 weekly Excel (.xlsx) export + 7-day retention purge — normally run by Vercel Cron
        (vercel.json); manual trigger here for System Admin
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => trigger('export')}>
          {busy === 'export' ? 'Running…' : 'Run weekly export now'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => trigger('purge')}>
          {busy === 'purge' ? 'Running…' : 'Run purge now'}
        </button>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Recent export jobs · click a column to sort</div>
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="PERIOD" sortKey="period_start" sort={exportSort} onSort={toggleExportSort} />
            <SortHeader label="STATUS" sortKey="status" sort={exportSort} onSort={toggleExportSort} />
            <SortHeader label="ROWS" sortKey="row_count" sort={exportSort} onSort={toggleExportSort} />
            <SortHeader label="FINISHED" sortKey="finished_at" sort={exportSort} onSort={toggleExportSort} />
            <th>DETAIL</th>
          </tr>
        </thead>
        <tbody>
          {exportPageRows.map((j) => (
            <tr key={j.id}>
              <td>
                {formatDate(j.period_start)} – {formatDate(j.period_end)}
              </td>
              <td>
                <span className={`badge badge-${j.status === 'success' ? 'success' : j.status === 'failed' ? 'danger' : 'warning'}`}>{j.status}</span>
              </td>
              <td>{j.row_count ?? '—'}</td>
              <td>{j.finished_at ? formatDateTime(j.finished_at) : '—'}</td>
              <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.error_detail ?? (j.target_ref ? <a href={j.target_ref} target="_blank" rel="noreferrer">{j.target_ref}</a> : '—')}
              </td>
            </tr>
          ))}
          {exportPageRows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                No export runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sortedExportJobs.length > 0 && <Pagination page={exportPage} totalPages={exportTotalPages} onChange={setExportPage} />}

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Recent purge log · click a column to sort</div>
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="CUTOFF" sortKey="covered_period_start" sort={purgeSort} onSort={togglePurgeSort} />
            <SortHeader label="TABLE" sortKey="table_name" sort={purgeSort} onSort={togglePurgeSort} />
            <SortHeader label="ROWS PURGED" sortKey="rows_purged" sort={purgeSort} onSort={togglePurgeSort} />
            <SortHeader label="RESULT" sortKey="result" sort={purgeSort} onSort={togglePurgeSort} />
            <SortHeader label="WHEN" sortKey="created_at" sort={purgeSort} onSort={togglePurgeSort} />
          </tr>
        </thead>
        <tbody>
          {purgePageRows.map((p) => (
            <tr key={p.id}>
              <td>{formatDate(p.covered_period_start)}</td>
              <td>{p.table_name}</td>
              <td>{p.rows_purged}</td>
              <td>
                <span className={`badge badge-${p.result === 'success' ? 'success' : 'danger'}`}>{p.result}</span>
              </td>
              <td>{formatDateTime(p.created_at)}</td>
            </tr>
          ))}
          {purgePageRows.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                No purge runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {sortedPurgeLog.length > 0 && <Pagination page={purgePage} totalPages={purgeTotalPages} onChange={setPurgePage} />}
    </div>
  )
}
