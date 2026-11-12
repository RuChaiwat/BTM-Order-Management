'use client'

import { useMemo, useState } from 'react'
import { Pagination } from '../Pagination'
import { formatDate } from '../../lib/formatDate'
import type { PackQueueRow } from '../../lib/queries/packing'

const PAGE_SIZE = 50

function waitText(m: number) {
  return m >= 1440 ? `${Math.floor(m / 1440)} วัน ${Math.floor((m % 1440) / 60)} ชม.` : m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`
}

// Same buckets as Packing Dashboard's "Pack backlog aging".
function waitColor(m: number) {
  return m >= 480 ? 'var(--color-danger-dark)' : m >= 240 ? 'var(--color-warning-dark)' : undefined
}

/** Orders waiting to pack -- searchable by order no / store, paged in the browser. */
export function PackQueueTable({ rows }: { rows: PackQueueRow[] }) {
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    return term ? rows.filter((r) => r.order_no.toLowerCase().includes(term) || r.store_code.toLowerCase().includes(term)) : rows
  }, [rows, q])
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const current = Math.min(page, totalPages)
  const shown = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE)

  return (
    <div className="card" style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <div>
          <div className="card-title">Orders waiting to pack</div>
          <div className="card-subtitle">order ที่ผ่าน Admin Verification แล้ว รอ scan แพ็ก · เรียงจากรอนานที่สุด · สีส้ม ≥ 4 ชม. · สีแดง ≥ 8 ชม.</div>
        </div>
        <input
          className="field-input"
          style={{ marginLeft: 'auto', width: 260, border: '1px solid var(--color-border)' }}
          placeholder="ค้นหาเลข order / รหัสร้าน"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setPage(1)
          }}
        />
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '14%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '14%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ORDER</th>
            <th>STORE</th>
            <th>
              SHIPMENT
              <br />
              DATE
            </th>
            <th>
              PICK
              <br />
              RESULT
            </th>
            <th>SKU</th>
            <th>PCS</th>
            <th>
              VERIFIED
              <br />
              AT
            </th>
            <th>WAITING</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.order_id}>
              <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>{r.order_no}</td>
              <td style={{ overflowWrap: 'break-word' }}>{r.store_code}</td>
              <td>{formatDate(r.order_date)}</td>
              <td>
                <span className={`badge ${r.pick_status === 'final_closed_short' ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: 10 }}>
                  {r.pick_status === 'final_closed_short' ? 'Short' : '100%'}
                </span>
              </td>
              <td>{r.skus.toLocaleString()}</td>
              <td style={{ fontWeight: 700 }}>{r.pieces.toLocaleString()}</td>
              <td style={{ fontSize: 12 }}>{r.pack_ready_at ? new Date(r.pack_ready_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'}</td>
              <td style={{ fontWeight: 700, color: waitColor(r.waitMinutes) }}>{waitText(r.waitMinutes)}</td>
            </tr>
          ))}
          {shown.length === 0 && (
            <tr>
              <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
                {rows.length === 0 ? 'ไม่มี order รอแพ็ก · Nothing waiting to pack.' : 'ไม่พบ order ที่ค้นหา'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div style={{ marginTop: 12 }}>
        <Pagination page={current} totalPages={totalPages} onChange={setPage} suffix={<>· {filtered.length.toLocaleString()} orders</>} />
      </div>
    </div>
  )
}
