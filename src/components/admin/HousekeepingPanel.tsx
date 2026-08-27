'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

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

export function HousekeepingPanel({ exportJobs, purgeLog }: { exportJobs: ExportJob[]; purgeLog: PurgeRow[] }) {
  const router = useRouter()
  const [busy, setBusy] = useState<'export' | 'purge' | null>(null)

  async function trigger(kind: 'export' | 'purge') {
    setBusy(kind)
    await fetch(kind === 'export' ? '/api/cron/weekly-export' : '/api/cron/purge')
    setBusy(null)
    router.refresh()
  }

  return (
    <div className="card">
      <div className="card-title">Housekeeping</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        §20.1/§20.2 weekly Google Sheets export + 7-day retention purge — normally run by Vercel Cron (vercel.json); manual trigger here for
        System Admin
      </div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => trigger('export')}>
          {busy === 'export' ? 'Running…' : 'Run weekly export now'}
        </button>
        <button className="btn btn-secondary btn-sm" disabled={busy !== null} onClick={() => trigger('purge')}>
          {busy === 'purge' ? 'Running…' : 'Run purge now'}
        </button>
      </div>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Recent export jobs</div>
      <table className="table" style={{ marginBottom: 16 }}>
        <thead>
          <tr>
            <th>PERIOD</th>
            <th>STATUS</th>
            <th>ROWS</th>
            <th>FINISHED</th>
            <th>DETAIL</th>
          </tr>
        </thead>
        <tbody>
          {exportJobs.map((j) => (
            <tr key={j.id}>
              <td>
                {j.period_start} – {j.period_end}
              </td>
              <td>
                <span className={`badge badge-${j.status === 'success' ? 'success' : j.status === 'failed' ? 'danger' : 'warning'}`}>{j.status}</span>
              </td>
              <td>{j.row_count ?? '—'}</td>
              <td>{j.finished_at ? new Date(j.finished_at).toLocaleString() : '—'}</td>
              <td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {j.error_detail ?? (j.target_ref ? <a href={j.target_ref} target="_blank" rel="noreferrer">{j.target_ref}</a> : '—')}
              </td>
            </tr>
          ))}
          {exportJobs.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                No export runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Recent purge log</div>
      <table className="table">
        <thead>
          <tr>
            <th>CUTOFF</th>
            <th>TABLE</th>
            <th>ROWS PURGED</th>
            <th>RESULT</th>
            <th>WHEN</th>
          </tr>
        </thead>
        <tbody>
          {purgeLog.map((p) => (
            <tr key={p.id}>
              <td>{p.covered_period_start}</td>
              <td>{p.table_name}</td>
              <td>{p.rows_purged}</td>
              <td>
                <span className={`badge badge-${p.result === 'success' ? 'success' : 'danger'}`}>{p.result}</span>
              </td>
              <td>{new Date(p.created_at).toLocaleString()}</td>
            </tr>
          ))}
          {purgeLog.length === 0 && (
            <tr>
              <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                No purge runs yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
