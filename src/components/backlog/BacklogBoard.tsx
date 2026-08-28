'use client'

import { useState } from 'react'

interface BacklogRow {
  order_id: string
  order_no: string
  store_code: string
  status: string
  original_order_date: string
  planned_pieces: number
  zones: string[]
  pickerName: string
  backlogType: 'picking' | 'verification' | 'both'
  alert?: { time_alert: string | null; elapsed_minutes: number } | null
}

const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'picking', label: 'Picking Backlog' },
  { key: 'verification', label: 'Verification Backlog' },
] as const

export function BacklogBoard({ rows }: { rows: BacklogRow[] }) {
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['key']>('all')
  const filtered = rows.filter((r) => filter === 'all' || r.backlogType === filter || r.backlogType === 'both')

  return (
    <div className="card" style={{ minHeight: 0 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Backlogged orders</span>
        <span className="card-subtitle">sorted by elapsed time, longest first</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {FILTERS.map((f) => (
            <button key={f.key} className={`btn btn-sm ${filter === f.key ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(f.key)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>ORDER NO.</th>
            <th>STORE</th>
            <th>ORDER DATE</th>
            <th>ZONES</th>
            <th>PICKER</th>
            <th>BACKLOG TYPE</th>
            <th>ELAPSED</th>
            <th>ALERT</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.order_id}>
              <td className="link">{r.order_no}</td>
              <td>{r.store_code}</td>
              <td>{r.original_order_date}</td>
              <td>{r.zones.join(', ') || '—'}</td>
              <td>{r.pickerName}</td>
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
          ))}
          {filtered.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
                No backlogged orders — nice work.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
