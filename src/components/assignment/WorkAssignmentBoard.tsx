'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'

const TARGET = 300
const LOW_MAX = 270
const ACCEPTABLE_MAX = 330

interface PoolOrder {
  order_id: string
  order_no: string
  store_code: string
  original_order_date: string
  planned_pieces: number
  unique_sku_count: number
  zones: string[]
}

interface Picker {
  user_id: string
  name_en: string
  zone_scope: string[]
}

function bandFor(pieces: number) {
  if (pieces === 0 || pieces < LOW_MAX) return { name: 'Low', color: '#2563EB' }
  if (pieces <= TARGET) return { name: 'Target', color: '#16A34A' }
  if (pieces <= ACCEPTABLE_MAX) return { name: 'Acceptable Over', color: '#F59E0B' }
  return { name: 'Over', color: '#DC2626' }
}

export function WorkAssignmentBoard({ orders, pickers, warehouseCode, zones }: { orders: PoolOrder[]; pickers: Picker[]; warehouseCode: string; zones: string[] }) {
  const router = useRouter()
  const [zone, setZone] = useState(zones[0] ?? '')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pickerId, setPickerId] = useState(pickers[0]?.user_id ?? '')
  const [scanValue, setScanValue] = useState('')
  const [scanUsed, setScanUsed] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const zoneOrders = useMemo(() => orders.filter((o) => o.zones.includes(zone)), [orders, zone])
  const availablePickers = useMemo(() => pickers.filter((p) => p.zone_scope.length === 0 || p.zone_scope.includes(zone)), [pickers, zone])

  function toggle(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(orderId)) next.delete(orderId)
      else next.add(orderId)
      return next
    })
  }

  function handleScan() {
    const match = zoneOrders.find((o) => o.order_no === scanValue.trim())
    if (!match) {
      setError(`No pending order '${scanValue}' found in Zone ${zone}`)
      return
    }
    setError(null)
    setScanUsed(true)
    setSelected((prev) => new Set(prev).add(match.order_id))
    setScanValue('')
  }

  const selectedOrders = zoneOrders.filter((o) => selected.has(o.order_id))
  const plannedPieces = selectedOrders.reduce((s, o) => s + o.planned_pieces, 0)
  const band = bandFor(plannedPieces)

  async function confirmAssignment() {
    setSubmitting(true)
    setError(null)
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_code: warehouseCode,
        zone_code: zone,
        picker_id: pickerId,
        order_ids: [...selected],
        assignment_method: scanUsed ? 'barcode_scan' : 'list_selection',
      }),
    })
    const body = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setError(body.error)
      return
    }
    setShowConfirm(false)
    setSelected(new Set())
    setScanUsed(false)
    router.refresh()
  }

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
        <div className="card" style={{ minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className="card-title">Unassigned Order Pool</span>
            <span className="card-subtitle">{zoneOrders.length} orders · Zone {zone || '—'}</span>
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              <select className="control" value={zone} onChange={(e) => { setZone(e.target.value); setSelected(new Set()) }}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    Zone {z}
                  </option>
                ))}
              </select>
              <input
                className="control"
                placeholder="Scan order barcode…"
                value={scanValue}
                onChange={(e) => setScanValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleScan()}
                style={{ width: 160 }}
              />
              <button className="btn btn-secondary btn-sm" onClick={handleScan}>
                Scan
              </button>
            </div>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                <th>ORDER NO.</th>
                <th>STORE</th>
                <th>ORDER DATE</th>
                <th>ZONES TOUCHED</th>
                <th>UNIQUE SKU</th>
                <th>PLANNED PCS</th>
              </tr>
            </thead>
            <tbody>
              {zoneOrders.map((o) => {
                const isSelected = selected.has(o.order_id)
                return (
                  <tr key={o.order_id} className={isSelected ? 'row-flag' : undefined}>
                    <td>
                      <button
                        onClick={() => toggle(o.order_id)}
                        className={`checkbox-box${isSelected ? ' checked' : ''}`}
                        style={{ border: isSelected ? 'none' : undefined, cursor: 'pointer', padding: 0 }}
                      >
                        {isSelected ? '✓' : ''}
                      </button>
                    </td>
                    <td className="link">{o.order_no}</td>
                    <td>{o.store_code}</td>
                    <td>{o.original_order_date}</td>
                    <td>{o.zones.join(', ')}</td>
                    <td>{o.unique_sku_count}</td>
                    <td style={{ fontWeight: 700 }}>{o.planned_pieces}</td>
                  </tr>
                )
              })}
              {zoneOrders.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                    No pending orders touch Zone {zone}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-title">Assignment Summary</div>
          <div className="card-subtitle" style={{ marginBottom: 14 }}>
            สรุปการมอบหมายงาน
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: band.color }}>{plannedPieces}</span>
            <span style={{ fontSize: 12.5, color: '#6B7280' }}>
              of {TARGET} target · {selectedOrders.length} orders
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: '#F3F4F6', overflow: 'hidden', margin: '10px 0 8px' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (plannedPieces / 360) * 100)}%`, background: band.color }} />
          </div>
          <div style={{ background: '#F9FAFB', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#374151' }}>
            Workload band: <strong style={{ color: band.color }}>{band.name}</strong>. Thresholds are configuration-driven (§12.1).
          </div>

          <div style={{ marginTop: 16, fontSize: 12, color: '#374151', fontWeight: 500, marginBottom: 6 }}>
            Assign to picker <span style={{ color: '#DC2626' }}>*</span>
          </div>
          <select className="field-input" value={pickerId} onChange={(e) => setPickerId(e.target.value)} style={{ border: '1px solid var(--color-border)' }}>
            {availablePickers.map((p) => (
              <option key={p.user_id} value={p.user_id}>
                {p.user_id} · {p.name_en}
              </option>
            ))}
            {availablePickers.length === 0 && <option value="">No pickers scoped to this zone</option>}
          </select>

          <div style={{ marginTop: 16, fontSize: 12, color: '#374151', fontWeight: 500, marginBottom: 8 }}>Selected orders</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, maxHeight: 160, overflowY: 'auto' }}>
            {selectedOrders.map((o) => (
              <div key={o.order_id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span>{o.order_no}</span>
                <span style={{ color: '#6B7280' }}>{o.planned_pieces} pcs</span>
              </div>
            ))}
            {selectedOrders.length === 0 && <span style={{ color: '#6B7280' }}>No orders selected.</span>}
          </div>

          {error && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}

          <div className="mt-auto" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-primary" disabled={selectedOrders.length === 0 || !pickerId} onClick={() => setShowConfirm(true)}>
              Confirm Assignment · เริ่มจับเวลา
            </button>
            <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'center' }}>Timer starts only on Admin confirm. Assignment is confined to Zone {zone}.</div>
          </div>
        </div>
      </div>

      {showConfirm && (
        <Modal title="Confirm assignment?" subtitle="ยืนยันการมอบหมายงาน">
          <div className="modal-body">
            {selectedOrders.length} orders · {plannedPieces} planned pieces to picker <strong>{pickerId}</strong> in Zone {zone}. The Order timer starts now.
          </div>
          <div className="modal-grid">
            <div>
              <div className="modal-grid-label">Workload level</div>
              <div className="modal-grid-value" style={{ color: band.color }}>
                {band.name} ({plannedPieces})
              </div>
            </div>
            <div>
              <div className="modal-grid-label">Method</div>
              <div className="modal-grid-value">{scanUsed ? 'Barcode Scan' : 'List Selection'}</div>
            </div>
          </div>
          <ModalFooter>
            <button className="modal-footer-btn btn-secondary" onClick={() => setShowConfirm(false)}>
              Cancel
            </button>
            <button className="modal-footer-btn btn-primary" style={{ minWidth: 190, border: 0 }} disabled={submitting} onClick={confirmAssignment}>
              {submitting ? 'Confirming…' : 'Confirm & start timer'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
