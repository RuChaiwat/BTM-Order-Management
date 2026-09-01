'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { batchStatusLabel, batchStatusTone } from '@/lib/matching/batchStatus'

interface Batch {
  consol_batch_id: string
  batch_no: string
  order_date: string
  priority: string
  stores_count: number
  orders_count: number
  unique_sku_count: number
  total_pieces: number
  status: string
  released_at: string | null
  report_generated_at: string | null
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#16A34A', P2: '#2563EB', P3: '#F59E0B', P4: '#DC2626' }

export function ConsolidationPickReportBoard({ batches }: { batches: Batch[] }) {
  const router = useRouter()
  const [busyBatch, setBusyBatch] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function markCompleted(batchId: string) {
    setBusyBatch(batchId)
    setError(null)
    const res = await fetch(`/api/consolidation-batches/${batchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'complete' }),
    })
    setBusyBatch(null)
    if (!res.ok) {
      const body = await res.json()
      setError(body.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="card" style={{ minHeight: 0 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Active pick &amp; sort worklist</span>
        <span className="card-subtitle">sorted by release time, oldest first</span>
      </div>
      {error && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
      <table className="table">
        <thead>
          <tr>
            <th>BATCH</th>
            <th>ORDER DATE</th>
            <th>PRIORITY</th>
            <th>STORES</th>
            <th>ORDERS</th>
            <th>PIECES</th>
            <th>RELEASED</th>
            <th>STATUS</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {batches.map((b) => (
            <tr key={b.consol_batch_id}>
              <td className="link">
                <Link href={`/pick-report/${b.consol_batch_id}`}>{b.batch_no}</Link>
              </td>
              <td>{b.order_date}</td>
              <td>
                <span style={{ color: PRIORITY_COLOR[b.priority], fontWeight: 700 }}>{b.priority}</span>
              </td>
              <td>{b.stores_count}</td>
              <td>{b.orders_count}</td>
              <td style={{ fontWeight: 700 }}>{b.total_pieces}</td>
              <td>{b.released_at ? new Date(b.released_at).toLocaleString() : '—'}</td>
              <td>
                <span className={`badge badge-${batchStatusTone(b.status)}`}>{batchStatusLabel(b.status)}</span>
              </td>
              <td>
                <div style={{ display: 'flex', gap: 6 }}>
                  <Link href={`/pick-report/${b.consol_batch_id}`} className="btn btn-secondary btn-sm" style={{ height: 28, padding: '0 10px', textDecoration: 'none' }}>
                    Open report
                  </Link>
                  <button className="btn btn-success btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busyBatch === b.consol_batch_id} onClick={() => markCompleted(b.consol_batch_id)}>
                    Mark completed
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {batches.length === 0 && (
            <tr>
              <td colSpan={9} style={{ color: 'var(--color-text-secondary)' }}>
                Nothing released and active right now — release a batch from Matching Analysis &amp; Batch Review.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
