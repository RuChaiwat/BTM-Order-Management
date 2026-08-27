'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'

interface Batch {
  consol_batch_id: string
  order_date: string
  priority: string
  match_pct: number | null
  stores_count: number
  orders_count: number
  unique_sku_count: number
  total_pieces: number
  status: string
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#16A34A', P2: '#2563EB', P3: '#F59E0B', P4: '#DC2626' }
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'success' | 'danger' | 'warning'> = {
  candidate: 'neutral',
  review: 'info',
  approved: 'success',
  report_released: 'success',
  picking: 'info',
  at_consolidation: 'info',
  sorting: 'info',
  completed: 'success',
  cancelled: 'danger',
}

export function MatchingBoard({ batches, warehouseCode, unmatchedPendingCount }: { batches: Batch[]; warehouseCode: string; unmatchedPendingCount: number }) {
  const router = useRouter()
  const [orderDate, setOrderDate] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return d.toISOString().slice(0, 10)
  })
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyBatch, setBusyBatch] = useState<string | null>(null)

  async function runMatching() {
    setRunning(true)
    setError(null)
    setResult(null)
    const res = await fetch('/api/matching/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ warehouse_code: warehouseCode, order_date: orderDate }),
    })
    const body = await res.json()
    setRunning(false)
    if (!res.ok) return setError(body.error)
    setResult(body)
    router.refresh()
  }

  async function act(batchId: string, action: 'approve' | 'release' | 'cancel') {
    setBusyBatch(batchId)
    await fetch(`/api/consolidation-batches/${batchId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    setBusyBatch(null)
    router.refresh()
  }

  return (
    <div className="page-body">
      <div className="card">
        <div className="card-title">Run matching</div>
        <div className="card-subtitle" style={{ marginBottom: 12 }}>
          §10 pre-screen + P1-P4 clustering · {unmatchedPendingCount} pending orders not yet matched or single-routed
        </div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div className="field">
            <label className="field-label">Order Date</label>
            <input type="date" className="field-input" value={orderDate} onChange={(e) => setOrderDate(e.target.value)} style={{ border: '1px solid var(--color-border)' }} />
          </div>
          <button className="btn btn-primary btn-sm" disabled={running} onClick={runMatching}>
            {running ? 'Matching…' : 'Run matching'}
          </button>
        </div>
        {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
        {result && (
          <div style={{ marginTop: 10, fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
            {String(result.eligible_count)} eligible · {String(result.excluded_over_max_sku)} excluded (over max SKU) · {(result.batches as unknown[]).length} batch(es) created ·{' '}
            {String(result.single_order_count)} routed to Single Order
          </div>
        )}
      </div>

      <div className="card" style={{ flex: 1, minHeight: 0 }}>
        <div className="card-title">Matching candidates &amp; batch review</div>
        <div className="card-subtitle" style={{ marginBottom: 12 }}>
          แดชบอร์ดการจับคู่ / ตรวจแบตช์ — approve, then release to generate the A4 pick report
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>BATCH</th>
              <th>DATE</th>
              <th>PRIORITY</th>
              <th>MATCH %</th>
              <th>STORES</th>
              <th>ORDERS</th>
              <th>PIECES</th>
              <th>STATUS</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {batches.map((b) => (
              <tr key={b.consol_batch_id}>
                <td className="link">
                  <Link href={`/pick-report/${b.consol_batch_id}`}>{b.consol_batch_id.slice(0, 8)}</Link>
                </td>
                <td>{b.order_date}</td>
                <td>
                  <span style={{ color: PRIORITY_COLOR[b.priority], fontWeight: 700 }}>{b.priority}</span>
                </td>
                <td>{b.match_pct !== null ? `${Math.round(b.match_pct * 100)}%` : '—'}</td>
                <td>{b.stores_count}</td>
                <td>{b.orders_count}</td>
                <td style={{ fontWeight: 700 }}>{b.total_pieces}</td>
                <td>
                  <span className={`badge badge-${STATUS_TONE[b.status] ?? 'neutral'}`}>{b.status}</span>
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {b.status === 'candidate' && (
                      <button className="btn btn-secondary btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busyBatch === b.consol_batch_id} onClick={() => act(b.consol_batch_id, 'approve')}>
                        Approve
                      </button>
                    )}
                    {b.status === 'approved' && (
                      <button className="btn btn-primary btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busyBatch === b.consol_batch_id} onClick={() => act(b.consol_batch_id, 'release')}>
                        Release
                      </button>
                    )}
                    {['candidate', 'approved'].includes(b.status) && (
                      <button className="btn btn-danger-outline btn-sm" style={{ height: 28, padding: '0 10px' }} disabled={busyBatch === b.consol_batch_id} onClick={() => act(b.consol_batch_id, 'cancel')}>
                        Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {batches.length === 0 && (
              <tr>
                <td colSpan={9} style={{ color: 'var(--color-text-secondary)' }}>
                  No consolidation batches yet — run matching above.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
