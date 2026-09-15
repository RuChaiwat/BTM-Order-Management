'use client'

import { useMemo, useState } from 'react'
import { Modal, ModalFooter } from '../Modal'
import { formatDate } from '../../lib/formatDate'

const TARGET = 300
const LOW_MAX = 270
const ACCEPTABLE_MAX = 330
const PAGE_SIZE = 15

interface BacklogByDate {
  orderDate: string
  orders: number
  pieces: number
}

interface ZoneDensity {
  zone: string
  orders: number
  sumQty: number
}

type Band = 'green' | 'yellow' | 'red'
type ComplexityBands = Record<Band, { count: number; sumPieces: number }>
type SortColumn = 'order_no' | 'store_code' | 'unique_sku_count' | 'planned_pieces'

interface PoolOrder {
  orderId: string
  orderNo: string
  storeCode: string
  plannedPieces: number
  uniqueSkuCount: number
  band?: Band
  zones?: string[]
}

/** A selected order, remembering which zone(s) it's known to be compatible with -- either its
 * real zone list (if it came in via the barcode scan fallback, which fetches the full list) or
 * just the single Criteria zone it was picked under (pool/checkbox selections only ever confirm
 * membership in that one zone, not the order's full zone list, which is a safe under-approximation
 * for the compatibility check below: it can never wrongly ALLOW an incompatible order, only rarely
 * disallow one that happens to also share a zone we don't know about). */
interface SelectedOrder extends PoolOrder {
  knownZones: string[]
}

interface Picker {
  picker_id: string
  badge_code: string
  name_en: string
  zone_scope: string[]
  active: boolean
}

const BAND_META: Record<Band, { label: string; color: string; bg: string }> = {
  green: { label: 'Green — Easy', color: '#16A34A', bg: '#F0FDF4' },
  yellow: { label: 'Yellow — Balanced', color: '#B45309', bg: '#FFFBEB' },
  red: { label: 'Red — Hard', color: '#DC2626', bg: '#FEF2F2' },
}

const SORT_LABELS: { key: SortColumn; label: string }[] = [
  { key: 'order_no', label: 'ORDER NO.' },
  { key: 'store_code', label: 'STORE' },
  { key: 'unique_sku_count', label: 'UNIQUE SKU' },
  { key: 'planned_pieces', label: 'PLANNED PCS' },
]

function workloadBandFor(pieces: number) {
  if (pieces === 0 || pieces < LOW_MAX) return { name: 'Low', color: '#2563EB' }
  if (pieces <= TARGET) return { name: 'Target', color: '#16A34A' }
  if (pieces <= ACCEPTABLE_MAX) return { name: 'Acceptable Over', color: '#F59E0B' }
  return { name: 'Over', color: '#DC2626' }
}

/** Zones common to every currently-selected order -- null means "no constraint yet" (nothing
 * selected). A candidate order can only be added if it shares at least one zone with this set. */
function compatibleZonesOf(orders: SelectedOrder[]): string[] | null {
  if (orders.length === 0) return null
  return orders.slice(1).reduce((acc, o) => acc.filter((z) => o.knownZones.includes(z)), orders[0].knownZones)
}

/**
 * Work Assignment, redesigned into 3 sections per Business's spec:
 *   1. Criteria — Backlog by Order Date -> click a date to see Zone density -> click a zone to
 *      see Order Complexity (red/yellow/green) -> plus a "scan Order Barcode" fallback that skips
 *      straight to a specific order regardless of date/zone.
 *   2. Unassigned Order Pool — the orders matching whatever Criteria selection is active,
 *      sortable and paginated (15/page) entirely server-side.
 *   3. Assignment Summary — unchanged workload band/confirm flow, except "Assign to worker" is
 *      now a Badge Code scan (resolved against the already-loaded active picker roster) instead
 *      of a login-account dropdown, since Pickers no longer have login accounts at all.
 */
export function WorkAssignmentBoard({ warehouseCode, initialBacklogByDate, pickers }: { warehouseCode: string; initialBacklogByDate: BacklogByDate[]; pickers: Picker[] }) {
  const [backlogByDate] = useState(initialBacklogByDate)
  const [orderDate, setOrderDate] = useState<string | null>(null)
  const [zoneDensity, setZoneDensity] = useState<ZoneDensity[]>([])
  const [zoneCode, setZoneCode] = useState<string | null>(null)
  const [complexity, setComplexity] = useState<ComplexityBands | null>(null)
  const [bandFilter, setBandFilter] = useState<Band | null>(null)
  const [sortColumn, setSortColumn] = useState<SortColumn>('order_no')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [poolOrders, setPoolOrders] = useState<PoolOrder[]>([])
  const [poolTotal, setPoolTotal] = useState(0)
  const [poolPage, setPoolPage] = useState(1)
  const [loadingZones, setLoadingZones] = useState(false)
  const [loadingPool, setLoadingPool] = useState(false)

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [selectedDetails, setSelectedDetails] = useState<Map<string, SelectedOrder>>(new Map())
  const [poolSelectError, setPoolSelectError] = useState<string | null>(null)

  const [orderScanValue, setOrderScanValue] = useState('')
  const [orderScanError, setOrderScanError] = useState<string | null>(null)
  const [orderScanUsed, setOrderScanUsed] = useState(false)

  const [pickerScanValue, setPickerScanValue] = useState('')
  const [pickerScanError, setPickerScanError] = useState<string | null>(null)
  const [scannedPicker, setScannedPicker] = useState<Picker | null>(null)

  const [showConfirm, setShowConfirm] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState<string | null>(null)

  async function fetchPool(date: string, zone: string, page: number, band: Band | null, sort: SortColumn, dir: 'asc' | 'desc') {
    setLoadingPool(true)
    const params = new URLSearchParams({ order_date: date, zone_code: zone, page: String(page), sort, sort_dir: dir })
    if (band) params.set('band', band)
    const res = await fetch(`/api/assignment-pool?${params.toString()}`)
    const body = await res.json()
    setLoadingPool(false)
    setComplexity(body.complexity ?? null)
    setPoolOrders(body.orders ?? [])
    setPoolTotal(body.totalOrders ?? 0)
    setPoolPage(page)
  }

  async function selectDate(date: string) {
    setOrderDate(date)
    setZoneCode(null)
    setComplexity(null)
    setBandFilter(null)
    setPoolOrders([])
    setPoolTotal(0)
    setLoadingZones(true)
    const res = await fetch(`/api/assignment-pool?order_date=${encodeURIComponent(date)}`)
    const body = await res.json()
    setLoadingZones(false)
    setZoneDensity(body.zoneDensity ?? [])
  }

  function selectZone(zone: string) {
    if (!orderDate) return
    setZoneCode(zone)
    setBandFilter(null)
    setPoolSelectError(null)
    fetchPool(orderDate, zone, 1, null, sortColumn, sortDir)
  }

  function selectBand(band: Band) {
    if (!orderDate || !zoneCode) return
    const next = bandFilter === band ? null : band
    setBandFilter(next)
    fetchPool(orderDate, zoneCode, 1, next, sortColumn, sortDir)
  }

  function changeSort(column: SortColumn) {
    if (!orderDate || !zoneCode) return
    const nextDir: 'asc' | 'desc' = sortColumn === column && sortDir === 'asc' ? 'desc' : 'asc'
    setSortColumn(column)
    setSortDir(nextDir)
    fetchPool(orderDate, zoneCode, 1, bandFilter, column, nextDir)
  }

  function changePage(page: number) {
    if (!orderDate || !zoneCode) return
    fetchPool(orderDate, zoneCode, page, bandFilter, sortColumn, sortDir)
  }

  const compatibleZones = useMemo(() => compatibleZonesOf([...selectedDetails.values()]), [selectedDetails])

  /** Returns an error message on rejection, or null on success -- returning the message directly
   * (rather than having callers read a shared error state right after calling this) avoids
   * reading a stale value, since setState updates aren't visible until the next render, and lets
   * each caller show the message in its own spot (Section 1's scan error vs. Section 2's pool
   * error) instead of duplicating it in both. */
  function addSelection(order: PoolOrder, knownZones: string[]): string | null {
    if (compatibleZones && !knownZones.some((z) => compatibleZones.includes(z))) {
      return compatibleZones.length > 0
        ? `Order ${order.orderNo} doesn't share a Zone with the orders already selected (compatible zone(s): ${compatibleZones.join(', ')})`
        : `Order ${order.orderNo} doesn't share a Zone with the orders already selected`
    }
    setSelected((prev) => new Set(prev).add(order.orderId))
    setSelectedDetails((prev) => new Map(prev).set(order.orderId, { ...order, knownZones }))
    return null
  }

  function removeSelection(orderId: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      next.delete(orderId)
      return next
    })
    setSelectedDetails((prev) => {
      const next = new Map(prev)
      next.delete(orderId)
      return next
    })
    setPoolSelectError(null)
  }

  function toggle(order: PoolOrder) {
    if (selected.has(order.orderId)) {
      removeSelection(order.orderId)
      return
    }
    // A pool row is only confirmed to touch the currently-selected Criteria zone -- treat that as
    // its known zone set (see SelectedOrder doc comment above).
    const err = addSelection(order, zoneCode ? [zoneCode] : [])
    setPoolSelectError(err)
  }

  async function handleOrderScan() {
    const value = orderScanValue.trim()
    if (!value) return
    setOrderScanError(null)
    const res = await fetch(`/api/assignment-pool?order_no=${encodeURIComponent(value)}`)
    const body = await res.json()
    const match: PoolOrder | null = body.scannedOrder
      ? {
          orderId: body.scannedOrder.orderId,
          orderNo: body.scannedOrder.orderNo,
          storeCode: body.scannedOrder.storeCode,
          plannedPieces: body.scannedOrder.plannedPieces,
          uniqueSkuCount: body.scannedOrder.uniqueSkuCount,
          zones: body.scannedOrder.zones,
        }
      : null
    if (!match) {
      setOrderScanError(`No pending order '${value}' found`)
      return
    }
    const knownZones = match.zones ?? []
    if (knownZones.length === 0) {
      setOrderScanError(`Order '${value}' has no resolved Zone (invalid/missing Bin Code) — can't be assigned yet`)
      return
    }
    const err = addSelection(match, knownZones)
    if (err) {
      setOrderScanError(err)
      return
    }
    if (!zoneCode) setZoneCode(knownZones[0])
    setOrderScanUsed(true)
    setOrderScanValue('')
  }

  function handlePickerScan() {
    const value = pickerScanValue.trim()
    if (!value) return
    setPickerScanError(null)
    const match = pickers.find((p) => p.badge_code === value)
    if (!match) {
      setPickerScanError(`No active picker with badge '${value}'`)
      return
    }
    if (effectiveZone && match.zone_scope.length > 0 && !match.zone_scope.includes(effectiveZone)) {
      setPickerScanError(`${match.name_en} is not scoped to Zone ${effectiveZone}`)
      return
    }
    setScannedPicker(match)
    setPickerScanValue('')
  }

  const selectedOrders = useMemo(() => [...selected].map((id) => selectedDetails.get(id)).filter((o): o is SelectedOrder => Boolean(o)), [selected, selectedDetails])
  const plannedPieces = selectedOrders.reduce((s, o) => s + o.plannedPieces, 0)
  const workloadBand = workloadBandFor(plannedPieces)
  // The zone the batch actually commits to -- narrows to whatever's still common across every
  // selected order; falls back to the Criteria zone while nothing's selected yet.
  const effectiveZone = compatibleZones && compatibleZones.length > 0 ? compatibleZones[0] : zoneCode

  async function confirmAssignment() {
    if (!effectiveZone || !scannedPicker) return
    setSubmitting(true)
    setSubmitError(null)
    const res = await fetch('/api/assignments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        warehouse_code: warehouseCode,
        zone_code: effectiveZone,
        picker_id: scannedPicker.picker_id,
        order_ids: [...selected],
        assignment_method: orderScanUsed ? 'barcode_scan' : 'list_selection',
      }),
    })
    const body = await res.json()
    setSubmitting(false)
    if (!res.ok) {
      setSubmitError(body.error)
      return
    }
    setShowConfirm(false)
    setSelected(new Set())
    setSelectedDetails(new Map())
    setOrderScanUsed(false)
    setScannedPicker(null)
    // Refresh the pool for the SAME Criteria selection (rather than resetting it) -- assigning one
    // picker's batch is usually the first of several against the same date/zone, so the admin can
    // keep going against an accurate remaining list without re-clicking through Criteria again.
    if (orderDate && zoneCode) fetchPool(orderDate, zoneCode, poolPage, bandFilter, sortColumn, sortDir)
  }

  const totalPages = Math.max(1, Math.ceil(poolTotal / PAGE_SIZE))

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '300px 1fr 360px', gap: 16, alignItems: 'start' }}>
        {/* Section 1: Criteria */}
        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-title">Criteria</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            เกณฑ์การเลือกออเดอร์
          </div>

          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>1. BACKLOG BY ORDER DATE</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14, maxHeight: 220, overflowY: 'auto' }}>
            {backlogByDate.map((d) => (
              <button
                key={d.orderDate}
                onClick={() => selectDate(d.orderDate)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--color-border)',
                  background: orderDate === d.orderDate ? 'var(--color-primary)' : 'transparent',
                  color: orderDate === d.orderDate ? '#fff' : undefined,
                  cursor: 'pointer',
                  textAlign: 'left',
                  fontSize: 12.5,
                }}
              >
                <span style={{ fontWeight: 700 }}>{formatDate(d.orderDate)}</span>
                <span style={{ fontSize: 11, opacity: 0.85 }}>
                  {d.orders.toLocaleString()} ord · {d.pieces.toLocaleString()} pcs
                </span>
              </button>
            ))}
            {backlogByDate.length === 0 && <span style={{ color: '#6B7280', fontSize: 12 }}>No backlog — pool is empty.</span>}
          </div>

          {orderDate && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>2. ZONE</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 14, maxHeight: 200, overflowY: 'auto' }}>
                {loadingZones && <span style={{ color: '#6B7280', fontSize: 12 }}>Loading…</span>}
                {!loadingZones &&
                  zoneDensity.map((z) => (
                    <button
                      key={z.zone}
                      onClick={() => selectZone(z.zone)}
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: '1px solid var(--color-border)',
                        background: zoneCode === z.zone ? 'var(--color-primary)' : 'transparent',
                        color: zoneCode === z.zone ? '#fff' : undefined,
                        cursor: 'pointer',
                        textAlign: 'left',
                        fontSize: 12.5,
                      }}
                    >
                      <span style={{ fontWeight: 700 }}>Zone {z.zone}</span>
                      <span style={{ fontSize: 11, opacity: 0.85 }}>
                        {z.orders} ord · {z.sumQty.toLocaleString()} pcs
                      </span>
                    </button>
                  ))}
                {!loadingZones && zoneDensity.length === 0 && <span style={{ color: '#6B7280', fontSize: 12 }}>No zones resolved for this date.</span>}
              </div>
            </>
          )}

          {zoneCode && complexity && (
            <>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>3. ORDER COMPLEXITY</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 14 }}>
                {(['green', 'yellow', 'red'] as const).map((band) => {
                  const meta = BAND_META[band]
                  const stat = complexity[band]
                  const active = bandFilter === band
                  return (
                    <button
                      key={band}
                      onClick={() => selectBand(band)}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        background: meta.bg,
                        border: active ? `2px solid ${meta.color}` : '1px solid transparent',
                        borderRadius: 8,
                        padding: '8px 10px',
                        cursor: 'pointer',
                        textAlign: 'left',
                      }}
                    >
                      <span style={{ width: 9, height: 9, borderRadius: '50%', background: meta.color, flex: 'none' }} />
                      <span style={{ fontSize: 12, fontWeight: 700, color: meta.color, flex: 1 }}>{meta.label}</span>
                      <span style={{ fontSize: 11.5, color: '#374151' }}>{stat.count} ord</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}

          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#6B7280', marginBottom: 6 }}>4. OR SCAN ORDER BARCODE</div>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              className="control"
              placeholder="Scan order barcode…"
              value={orderScanValue}
              onChange={(e) => setOrderScanValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleOrderScan()}
              style={{ flex: 1, minWidth: 0 }}
            />
            <button className="btn btn-secondary btn-sm" onClick={handleOrderScan}>
              Scan
            </button>
          </div>
          {orderScanError && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-danger)' }}>{orderScanError}</div>}
        </div>

        {/* Section 2: Unassigned Order Pool */}
        <div className="card" style={{ minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <span className="card-title">Unassigned Order Pool</span>
            <span className="card-subtitle">
              {orderDate && zoneCode ? `${poolTotal.toLocaleString()} orders · ${formatDate(orderDate)} · Zone ${zoneCode}${bandFilter ? ` · ${BAND_META[bandFilter].label}` : ''}` : 'Select a date and zone to see orders'}
            </span>
          </div>
          {poolSelectError && <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--color-danger)' }}>{poolSelectError}</div>}
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 28 }} />
                {SORT_LABELS.map((col) => (
                  <th key={col.key} onClick={() => changeSort(col.key)} style={{ cursor: 'pointer', userSelect: 'none' }}>
                    {col.label} {sortColumn === col.key ? (sortDir === 'asc' ? '▲' : '▼') : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loadingPool && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                    Loading…
                  </td>
                </tr>
              )}
              {!loadingPool &&
                poolOrders.map((o) => {
                  const isSelected = selected.has(o.orderId)
                  return (
                    <tr key={o.orderId} className={isSelected ? 'row-flag' : undefined}>
                      <td>
                        <button
                          onClick={() => toggle(o)}
                          className={`checkbox-box${isSelected ? ' checked' : ''}`}
                          style={{ border: isSelected ? 'none' : undefined, cursor: 'pointer', padding: 0 }}
                        >
                          {isSelected ? '✓' : ''}
                        </button>
                      </td>
                      <td className="link">{o.orderNo}</td>
                      <td>{o.storeCode}</td>
                      <td>{o.uniqueSkuCount}</td>
                      <td style={{ fontWeight: 700 }}>{o.plannedPieces}</td>
                    </tr>
                  )
                })}
              {!loadingPool && poolOrders.length === 0 && (
                <tr>
                  <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                    {orderDate && zoneCode ? 'No orders match the current criteria.' : 'No orders loaded yet — pick a date and zone, or scan an order barcode.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          {orderDate && zoneCode && totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10, fontSize: 12 }}>
              <button className="btn btn-secondary btn-sm" disabled={poolPage <= 1} onClick={() => changePage(poolPage - 1)}>
                Prev
              </button>
              <span style={{ color: '#6B7280', alignSelf: 'center' }}>
                Page {poolPage} of {totalPages}
              </span>
              <button className="btn btn-secondary btn-sm" disabled={poolPage >= totalPages} onClick={() => changePage(poolPage + 1)}>
                Next
              </button>
            </div>
          )}
        </div>

        {/* Section 3: Assignment Summary */}
        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-title">Assignment Summary</div>
          <div className="card-subtitle" style={{ marginBottom: 14 }}>
            สรุปการมอบหมายงาน
          </div>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <span style={{ fontSize: 34, fontWeight: 700, color: workloadBand.color }}>{plannedPieces}</span>
            <span style={{ fontSize: 12.5, color: '#6B7280' }}>
              of {TARGET} target · {selectedOrders.length} orders
            </span>
          </div>
          <div style={{ height: 10, borderRadius: 5, background: '#F3F4F6', overflow: 'hidden', margin: '10px 0 8px' }}>
            <span style={{ display: 'block', height: '100%', width: `${Math.min(100, (plannedPieces / 360) * 100)}%`, background: workloadBand.color }} />
          </div>
          <div style={{ background: '#F9FAFB', border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 12, color: '#374151' }}>
            Workload band: <strong style={{ color: workloadBand.color }}>{workloadBand.name}</strong>. Thresholds are configuration-driven (§12.1).
          </div>

          <div style={{ marginTop: 16, fontSize: 12, color: '#374151', fontWeight: 500, marginBottom: 6 }}>
            Assign to picker <span style={{ color: '#DC2626' }}>*</span>
          </div>
          {scannedPicker ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: '#F0FDF4', border: '1px solid #BBF7D0', borderRadius: 8, padding: '10px 12px' }}>
              <div>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{scannedPicker.name_en}</div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  {scannedPicker.picker_id} · Badge {scannedPicker.badge_code}
                </div>
              </div>
              <button className="btn btn-secondary btn-sm" onClick={() => setScannedPicker(null)}>
                Change
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                className="control"
                placeholder="Scan picker badge…"
                value={pickerScanValue}
                onChange={(e) => setPickerScanValue(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handlePickerScan()}
                style={{ flex: 1, minWidth: 0 }}
              />
              <button className="btn btn-secondary btn-sm" onClick={handlePickerScan}>
                Scan
              </button>
            </div>
          )}
          {pickerScanError && <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-danger)' }}>{pickerScanError}</div>}

          <div style={{ marginTop: 16, fontSize: 12, color: '#374151', fontWeight: 500, marginBottom: 8 }}>Selected orders</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12.5, maxHeight: 160, overflowY: 'auto' }}>
            {selectedOrders.map((o) => (
              <div key={o.orderId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                <span>{o.orderNo}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ color: '#6B7280' }}>{o.plannedPieces} pcs</span>
                  <button
                    onClick={() => removeSelection(o.orderId)}
                    title="Remove"
                    style={{ border: '1px solid var(--color-border)', background: '#fff', borderRadius: 4, width: 20, height: 20, lineHeight: '18px', cursor: 'pointer', color: 'var(--color-danger)', padding: 0 }}
                  >
                    −
                  </button>
                </span>
              </div>
            ))}
            {selectedOrders.length === 0 && <span style={{ color: '#6B7280' }}>No orders selected.</span>}
          </div>

          {submitError && <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-danger)' }}>{submitError}</div>}

          <div className="mt-auto" style={{ paddingTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button className="btn btn-primary" disabled={selectedOrders.length === 0 || !scannedPicker || !effectiveZone} onClick={() => setShowConfirm(true)}>
              Confirm Assignment · เริ่มจับเวลา
            </button>
            <div style={{ fontSize: 11, color: '#6B7280', textAlign: 'center' }}>Timer starts only on Admin confirm. Assignment is confined to Zone {effectiveZone ?? '—'}.</div>
          </div>
        </div>
      </div>

      {showConfirm && scannedPicker && (
        <Modal title="Confirm assignment?" subtitle="ยืนยันการมอบหมายงาน">
          <div className="modal-body">
            {selectedOrders.length} orders · {plannedPieces} planned pieces to picker <strong>{scannedPicker.name_en}</strong> in Zone {effectiveZone}. The Order timer starts now.
          </div>
          <div className="modal-grid">
            <div>
              <div className="modal-grid-label">Workload level</div>
              <div className="modal-grid-value" style={{ color: workloadBand.color }}>
                {workloadBand.name} ({plannedPieces})
              </div>
            </div>
            <div>
              <div className="modal-grid-label">Order selection method</div>
              <div className="modal-grid-value">{orderScanUsed ? 'Barcode Scan' : 'List Selection'}</div>
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
