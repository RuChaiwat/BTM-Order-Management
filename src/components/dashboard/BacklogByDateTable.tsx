import type { ReactNode } from 'react'
import { Legend } from '../Legend'
import { formatDate } from '../../lib/formatDate'

export interface StageDef {
  key: string
  label: string
  color: string
}

export interface StageRow {
  orderDate: string
  orders: number
  pieces: number
  byStage: Record<string, { orders: number; pieces: number }>
  oldestMinutes?: number
}

/** Wait time with days for a multi-day backlog: "2 วัน 6 ชม.", "20 ชม.", "45 นาที". */
function ageText(minutes: number) {
  if (minutes >= 1440) {
    const h = Math.floor((minutes % 1440) / 60)
    return `${Math.floor(minutes / 1440)} วัน${h ? ` ${h} ชม.` : ''}`
  }
  return minutes >= 60 ? `${Math.floor(minutes / 60)} ชม.` : `${minutes} นาที`
}

/** One segment per stage, width by orders; hover shows that stage's orders and pieces. */
function StageBar({ row, stages }: { row: StageRow; stages: StageDef[] }) {
  const segs = stages.filter((s) => (row.byStage[s.key]?.orders ?? 0) > 0)
  return (
    <div style={{ display: 'flex', height: 12 }}>
      {segs.map((s, i) => {
        const c = row.byStage[s.key]
        const first = i === 0 ? 3 : 0
        const last = i === segs.length - 1 ? 3 : 0
        return (
          <div
            key={s.key}
            className="seg-tip"
            data-tip={`${s.label}\n${c.orders.toLocaleString()} order · ${c.pieces.toLocaleString()} ชิ้น`}
            style={{ width: `${(c.orders / row.orders) * 100}%`, background: s.color, borderRadius: `${first}px ${last}px ${last}px ${first}px` }}
          />
        )
      })}
    </div>
  )
}

/** Backlog by order date with a stage bar -- the layout Packing Dashboard uses, shared by
 * Operations Dashboard's Pick and Pack backlog cards. */
export function BacklogByDateTable({
  title,
  subtitle,
  action,
  rows,
  total,
  stages,
  todayKey,
  emptyText,
}: {
  title: string
  subtitle: string
  action?: ReactNode
  rows: StageRow[]
  total: StageRow
  stages: StageDef[]
  todayKey: string
  emptyText: string
}) {
  const daysOld = (dateKey: string) => Math.round((Date.parse(todayKey) - Date.parse(dateKey)) / 86400000)
  return (
    <div className="card">
      <div className="card-header" style={{ marginBottom: 2 }}>
        <span className="card-title">{title}</span>
        {action}
      </div>
      <div className="card-subtitle" style={{ marginBottom: 10 }}>
        {subtitle} · {rows.length.toLocaleString()} วัน · {total.orders.toLocaleString()} order
      </div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%', fontSize: 12.5 }}>
        <colgroup>
          <col style={{ width: '20%' }} />
          <col style={{ width: '11%' }} />
          <col style={{ width: '12%' }} />
          <col style={{ width: '42%' }} />
          <col style={{ width: '15%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ORDER DATE</th>
            <th>ORDER</th>
            <th>ชิ้น</th>
            <th>งานที่เหลือ</th>
            <th>รอนานสุด</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const days = daysOld(r.orderDate)
            const oldest = r.oldestMinutes ?? 0
            return (
              <tr key={r.orderDate}>
                <td style={{ fontWeight: 700 }}>
                  {formatDate(r.orderDate)}{' '}
                  {days >= 2 ? (
                    <span className="badge badge-danger" style={{ fontSize: 10 }}>
                      {days} วัน
                    </span>
                  ) : days === 0 ? (
                    <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--color-text-secondary)' }}>วันนี้</span>
                  ) : null}
                </td>
                <td>{r.orders.toLocaleString()}</td>
                <td>{r.pieces.toLocaleString()}</td>
                <td>
                  <StageBar row={r} stages={stages} />
                </td>
                <td style={{ fontWeight: 700, color: oldest >= 480 ? '#DC2626' : undefined }}>{ageText(oldest)}</td>
              </tr>
            )
          })}
          {rows.length === 0 ? (
            <tr>
              <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                {emptyText}
              </td>
            </tr>
          ) : (
            <tr>
              <td style={{ fontWeight: 700 }}>รวม</td>
              <td style={{ fontWeight: 700 }}>{total.orders.toLocaleString()}</td>
              <td style={{ fontWeight: 700 }}>{total.pieces.toLocaleString()}</td>
              <td>
                <StageBar row={total} stages={stages} />
              </td>
              <td />
            </tr>
          )}
        </tbody>
      </table>
      <Legend style={{ marginTop: 10 }} items={stages.map((s) => ({ color: s.color, label: s.label }))} note="ชี้ที่แถบสีเพื่อดูจำนวน order และชิ้น ·" />
    </div>
  )
}
