'use client'

import { useMemo, useState } from 'react'
import { Pagination } from '../Pagination'
import { Legend } from '../Legend'
import { formatDate } from '../../lib/formatDate'
import { BACKLOG_META } from '../../lib/packBacklog'
import type { PackQueueRow } from '../../lib/queries/packing'

const PAGE_SIZE = 50

function waitText(m: number) {
  return m >= 1440 ? `${Math.floor(m / 1440)} วัน ${Math.floor((m % 1440) / 60)} ชม.` : m >= 60 ? `${Math.floor(m / 60)} ชม. ${m % 60} นาที` : `${m} นาที`
}

// Waiting time since Admin Verification: amber from 4 hours, red from 8 hours.
function waitColor(m: number) {
  return m >= 480 ? 'var(--color-danger-dark)' : m >= 240 ? 'var(--color-warning-dark)' : undefined
}

/** Pack backlog orders -- searchable by order no / store, paged in the browser. showStatus adds
 * the pack status column (when the list mixes statuses). */
export function PackQueueTable({ rows, showStatus = false, title = 'Orders waiting to pack' }: { rows: PackQueueRow[]; showStatus?: boolean; title?: string }) {
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
          <div className="card-title">{title}</div>
          <div className="card-subtitle">รอนับจากเวลาที่ผ่าน Admin Verification</div>
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
          <col style={{ width: showStatus ? '18%' : '20%' }} />
          <col style={{ width: showStatus ? '11%' : '14%' }} />
          <col style={{ width: '12%' }} />
          {showStatus && <col style={{ width: '13%' }} />}
          <col style={{ width: '9%' }} />
          <col style={{ width: '7%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '11%' }} />
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
            {showStatus && <th>STATUS</th>}
            <th>
              PICK
              <br />
              RESULT
            </th>
            <th>ITEMS</th>
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
              {showStatus && (
                <td>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: BACKLOG_META[r.pack_status].color, flex: '0 0 auto' }} />
                    {BACKLOG_META[r.pack_status].label}
                  </span>
                </td>
              )}
              <td>
                <span className={`badge ${r.pick_status === 'final_closed_short' ? 'badge-warning' : 'badge-success'}`} style={{ fontSize: 10 }}>
                  {r.pick_status === 'final_closed_short' ? 'ไม่ครบ' : '100%'}
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
              <td colSpan={showStatus ? 9 : 8} style={{ color: 'var(--color-text-secondary)' }}>
                {rows.length === 0 ? 'ไม่มี order ในรายการนี้' : 'ไม่พบ order ที่ค้นหา'}
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <Legend
        style={{ marginTop: 10 }}
        items={[
          { color: waitColor(240)!, label: 'รอ 4 ชม. ขึ้นไป' },
          { color: waitColor(480)!, label: 'รอ 8 ชม. ขึ้นไป' },
        ]}
      />
      <div style={{ marginTop: 12 }}>
        <Pagination page={current} totalPages={totalPages} onChange={setPage} suffix={<>· {filtered.length.toLocaleString()} order</>} />
      </div>
    </div>
  )
}
