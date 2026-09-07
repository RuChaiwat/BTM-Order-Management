'use client'

import { useState } from 'react'
import { KpiCard } from '../KpiCard'

interface ZoneOrder {
  order_id: string
  order_no: string
  status: string
  pickerName: string
  alert?: { time_alert: string | null; elapsed_minutes: number } | null
}

interface ZoneDetail {
  zone: string
  orders: ZoneOrder[]
  activePickers: number
  activePickerTotalPieces: number
  activePickerTotalOrders: number
  assigned: number
  correctionInProgress: number
  completed: number
  pickingBacklog: number
  verificationBacklog: number
  verificationBacklogPieces: number
  critical: number
  overdue: number
  totalPieces: number
  pendingPieces: number
  slaPct: number
}

const STATUS_LABEL: Record<string, string> = {
  new: 'New',
  assigned: 'Assigned',
  in_progress: 'In Progress',
  picker_completed_100: 'Picker Completed 100%',
  picker_completed_short: 'Picker Completed Short',
  correction_in_progress: 'Correction in Progress',
  final_closed_100: 'Final Closed 100%',
  final_closed_short: 'Final Closed Short',
  cancelled: 'Cancelled',
}

export function ZoneDashboardBoard({ zoneDetail, initialZone }: { zoneDetail: ZoneDetail[]; initialZone?: string }) {
  const [activeZone, setActiveZone] = useState(() => (initialZone && zoneDetail.some((z) => z.zone === initialZone) ? initialZone : (zoneDetail[0]?.zone ?? '')))
  const selected = zoneDetail.find((z) => z.zone === activeZone) ?? zoneDetail[0]

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {zoneDetail.map((z) => (
          <button
            key={z.zone}
            onClick={() => setActiveZone(z.zone)}
            className="card"
            style={{
              textAlign: 'left',
              cursor: 'pointer',
              flex: '1 1 150px',
              minWidth: 150,
              maxWidth: 200,
              border: z.zone === activeZone ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
              padding: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Zone {z.zone}</div>
            <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0' }}>{z.pendingPieces.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>pieces pending</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>
              {z.totalPieces.toLocaleString()} total pieces · {z.activePickers} active picker(s)
            </div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
              {z.critical > 0 && <span className="badge badge-danger">{z.critical} critical</span>}
              {z.overdue > 0 && <span className="badge badge-warning">{z.overdue} overdue</span>}
              {z.critical === 0 && z.overdue === 0 && <span className="badge badge-success">On track</span>}
            </div>
          </button>
        ))}
        {zoneDetail.length === 0 && <div className="card">No zones found — import Location Master data first.</div>}
      </div>

      {selected && (
        <>
          <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 12 }}>
            <KpiCard
              label="TOTAL PIECES (PCS)"
              value={selected.totalPieces.toLocaleString()}
              sub={`${selected.orders.length.toLocaleString()} orders`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="PENDING PIECES (PCS)"
              value={selected.pendingPieces.toLocaleString()}
              valueColor={selected.pendingPieces > 0 ? '#F59E0B' : undefined}
              sub={`${selected.orders.length - selected.completed} orders`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="ACTIVE PICKERS (PCS)"
              value={selected.activePickerTotalPieces.toLocaleString()}
              sub={`${selected.activePickers} picker(s) · ${selected.activePickerTotalOrders} orders in hand`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="ASSIGNED / CORRECTION"
              value={`${selected.assigned} / ${selected.correctionInProgress}`}
              sub="orders"
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="BACKLOG P/V"
              value={`${selected.pickingBacklog} / ${selected.verificationBacklog}`}
              valueColor="#F59E0B"
              sub={`${selected.verificationBacklogPieces.toLocaleString()} pcs waiting verify`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="SLA"
              value={`${selected.slaPct}%`}
              valueColor={selected.slaPct >= 85 ? '#16A34A' : '#DC2626'}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
          </div>

          <div className="card" style={{ minHeight: 0 }}>
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Zone {selected.zone} — Orders</span>
              <span className="card-subtitle">sorted by elapsed time, most overdue first</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>ORDER NO.</th>
                  <th>STATUS</th>
                  <th>PICKER</th>
                  <th>ELAPSED</th>
                  <th>ALERT</th>
                </tr>
              </thead>
              <tbody>
                {selected.orders.map((o) => (
                  <tr key={o.order_id}>
                    <td className="link">{o.order_no}</td>
                    <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                    <td>{o.pickerName}</td>
                    <td>{o.alert ? `${Math.round(o.alert.elapsed_minutes)} min` : '—'}</td>
                    <td>
                      {o.alert?.time_alert ? (
                        <span className={`badge badge-${o.alert.time_alert === 'critical' ? 'danger' : o.alert.time_alert === 'overdue' ? 'warning' : 'info'}`}>{o.alert.time_alert}</span>
                      ) : (
                        <span style={{ color: '#9CA3AF' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {selected.orders.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      No orders touch Zone {selected.zone} right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
