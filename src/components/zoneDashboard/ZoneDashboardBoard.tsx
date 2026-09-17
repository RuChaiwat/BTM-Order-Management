'use client'

import { useMemo, useState } from 'react'
import { KpiCard } from '../KpiCard'

interface ZoneActiveOrderRow {
  orderId: string
  orderNo: string
  status: string
  pickerName: string
  elapsedMinutes: number
  timeAlert: string | null
}

interface ZoneShortPickRow {
  orderId: string
  orderNo: string
  sku: string
  pickerName: string
  orderedQty: number
  shortQty: number
  reason: string
}

interface ZoneDetail {
  zone: string
  activeOrders: ZoneActiveOrderRow[]
  shortPickRows: ZoneShortPickRow[]
  activePickers: number
  activePickerTotalPieces: number
  activePickerTotalOrders: number
  pickingBacklog: number
  verificationBacklog: number
  verificationBacklogPieces: number
  qtyShortPieces: number
  qtyShortOrders: number
  totalPieces: number
  pendingPieces: number
  slaPct: number
  riskLevel: 'red' | 'yellow' | 'green'
  criticalCount: number
  overdueCount: number
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

const RISK_COLOR: Record<ZoneDetail['riskLevel'], string> = { red: '#DC2626', yellow: '#F59E0B', green: '#16A34A' }
const PAGE_SIZE = 15

type OrderSortColumn = 'orderNo' | 'pickerName' | 'status' | 'elapsedMinutes' | 'timeAlert'
type ShortSortColumn = 'orderNo' | 'sku' | 'pickerName' | 'orderedQty' | 'shortQty' | 'reason'

function useSortedPage<T, K extends string>(rows: T[], initialSort: K, getters: Record<K, (row: T) => string | number>) {
  const [sortColumn, setSortColumn] = useState<K>(initialSort)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  function changeSort(column: K) {
    if (column === sortColumn) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortColumn(column)
      setSortDir('asc')
    }
    setPage(1)
  }

  const sorted = useMemo(() => {
    const get = getters[sortColumn]
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = get(a)
      const bv = get(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return sortDir === 'asc' ? cmp : -cmp
    })
    return copy
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sortColumn, sortDir])

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const clampedPage = Math.min(page, totalPages)
  const pageRows = sorted.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)

  return { sortColumn, sortDir, changeSort, page: clampedPage, setPage, totalPages, pageRows, total: sorted.length }
}

function SortHeader<K extends string>({ label, column, active, dir, onSort }: { label: string; column: K; active: K; dir: 'asc' | 'desc'; onSort: (c: K) => void }) {
  return (
    <th onClick={() => onSort(column)} style={{ cursor: 'pointer', userSelect: 'none' }}>
      {label} {active === column ? (dir === 'asc' ? '▲' : '▼') : ''}
    </th>
  )
}

function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  // Always rendered (even for a single page) so the table's bottom edge is always visually
  // anchored by a "Page X of Y" footer instead of ending abruptly right where the next card begins.
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--color-border-light)', fontSize: 12 }}>
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </button>
      <span style={{ color: '#6B7280' }}>
        Page {page} of {totalPages}
      </span>
      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  )
}

export function ZoneDashboardBoard({ zoneDetail, initialZone }: { zoneDetail: ZoneDetail[]; initialZone?: string }) {
  const [activeZone, setActiveZone] = useState(() => (initialZone && zoneDetail.some((z) => z.zone === initialZone) ? initialZone : (zoneDetail[0]?.zone ?? '')))
  const selected = zoneDetail.find((z) => z.zone === activeZone) ?? zoneDetail[0]

  const orderTable = useSortedPage<ZoneActiveOrderRow, OrderSortColumn>(selected?.activeOrders ?? [], 'elapsedMinutes', {
    orderNo: (o) => o.orderNo,
    pickerName: (o) => o.pickerName,
    status: (o) => o.status,
    elapsedMinutes: (o) => o.elapsedMinutes,
    timeAlert: (o) => o.timeAlert ?? '',
  })

  const shortTable = useSortedPage<ZoneShortPickRow, ShortSortColumn>(selected?.shortPickRows ?? [], 'shortQty', {
    orderNo: (r) => r.orderNo,
    sku: (r) => r.sku,
    pickerName: (r) => r.pickerName,
    orderedQty: (r) => r.orderedQty,
    shortQty: (r) => r.shortQty,
    reason: (r) => r.reason,
  })

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {zoneDetail.map((z) => (
          <button
            key={z.zone}
            onClick={() => setActiveZone(z.zone)}
            className="card"
            style={{
              textAlign: 'center',
              cursor: 'pointer',
              flex: '1 1 150px',
              minWidth: 150,
              maxWidth: 200,
              // Selection is shown via boxShadow (an outline drawn outside the border box), never via
              // the border itself -- border color is reserved for riskLevel on all 4 sides. Mixing the
              // two into one `border`/`borderTop` pair previously meant clicking a zone painted 3 of
              // its 4 sides in --color-primary (which is red), drowning out a green/yellow risk color.
              border: `2px solid ${RISK_COLOR[z.riskLevel]}`,
              boxShadow: z.zone === activeZone ? '0 0 0 2px var(--color-info)' : 'none',
              padding: 14,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700 }}>Zone {z.zone}</div>
            <div style={{ fontSize: 22, fontWeight: 700, margin: '4px 0' }}>{z.pendingPieces.toLocaleString()}</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>pieces pending</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{z.totalPieces.toLocaleString()} total pieces</div>
            <div style={{ fontSize: 11, color: '#6B7280' }}>{z.activePickers} active picker(s)</div>
            <div style={{ marginTop: 8, display: 'flex', gap: 6, justifyContent: 'center' }}>
              {z.criticalCount > 0 && <span className="badge badge-danger">{z.criticalCount} critical</span>}
              {z.criticalCount === 0 && z.overdueCount > 0 && <span className="badge badge-warning">{z.overdueCount} overdue</span>}
              {z.criticalCount === 0 && z.overdueCount === 0 && <span className="badge badge-success">On track</span>}
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
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="PENDING PIECES (PCS)"
              value={selected.pendingPieces.toLocaleString()}
              valueColor={selected.pendingPieces > 0 ? '#F59E0B' : undefined}
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
            <KpiCard
              label="ACTIVE PICKERS (PCS)"
              value={selected.activePickerTotalPieces.toLocaleString()}
              sub={`${selected.activePickers} picker(s) · ${selected.activePickerTotalOrders} orders in hand`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="PICKING / VERIFY"
              value={`${selected.pickingBacklog} / ${selected.verificationBacklog}`}
              valueColor="#F59E0B"
              sub={`${selected.verificationBacklogPieces.toLocaleString()} pcs waiting verify`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
            <KpiCard
              label="QTY SHORT (PCS)"
              value={selected.qtyShortPieces.toLocaleString()}
              valueColor={selected.qtyShortPieces > 0 ? '#DC2626' : undefined}
              sub={`${selected.qtyShortOrders.toLocaleString()} order(s)`}
              compact
              style={{ padding: 14, textAlign: 'center' }}
            />
          </div>

          {/* No minHeight:0 here -- .app-shell is a fixed 100vh flex column with overflow:hidden, so a
              flex-item card allowed to shrink below its content (minHeight:0) gets squeezed by the
              flex algorithm once the page's total content exceeds the viewport, and the table's
              overflow rows spill visually into the next card instead of the page just scrolling. */}
          <div className="card">
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Zone {selected.zone} — Active Picker Orders</span>
              <span className="card-subtitle">{orderTable.total} orders currently being picked · click a column to sort</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="ORDER NO." column="orderNo" active={orderTable.sortColumn} dir={orderTable.sortDir} onSort={orderTable.changeSort} />
                  <SortHeader label="PICKER" column="pickerName" active={orderTable.sortColumn} dir={orderTable.sortDir} onSort={orderTable.changeSort} />
                  <SortHeader label="STATUS" column="status" active={orderTable.sortColumn} dir={orderTable.sortDir} onSort={orderTable.changeSort} />
                  <SortHeader label="ELAPSED" column="elapsedMinutes" active={orderTable.sortColumn} dir={orderTable.sortDir} onSort={orderTable.changeSort} />
                  <SortHeader label="ALERT" column="timeAlert" active={orderTable.sortColumn} dir={orderTable.sortDir} onSort={orderTable.changeSort} />
                </tr>
              </thead>
              <tbody>
                {orderTable.pageRows.map((o) => (
                  <tr key={o.orderId}>
                    <td className="link">{o.orderNo}</td>
                    <td>{o.pickerName}</td>
                    <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                    <td>{o.elapsedMinutes} min</td>
                    <td>
                      {o.timeAlert ? (
                        <span className={`badge badge-${o.timeAlert === 'critical' ? 'danger' : o.timeAlert === 'overdue' ? 'warning' : 'info'}`}>{o.timeAlert}</span>
                      ) : (
                        <span style={{ color: '#9CA3AF' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))}
                {orderTable.pageRows.length === 0 && (
                  <tr>
                    <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                      No orders being actively picked in Zone {selected.zone} right now.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pagination page={orderTable.page} totalPages={orderTable.totalPages} onChange={orderTable.setPage} />
          </div>

          <div className="card">
            <div className="card-header" style={{ marginBottom: 10 }}>
              <span className="card-title">Zone {selected.zone} — Confirmed Short Picks</span>
              <span className="card-subtitle">{shortTable.total} short-picked line(s) · click a column to sort</span>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <SortHeader label="ORDER" column="orderNo" active={shortTable.sortColumn} dir={shortTable.sortDir} onSort={shortTable.changeSort} />
                  <SortHeader label="SKU" column="sku" active={shortTable.sortColumn} dir={shortTable.sortDir} onSort={shortTable.changeSort} />
                  <SortHeader label="PICKER" column="pickerName" active={shortTable.sortColumn} dir={shortTable.sortDir} onSort={shortTable.changeSort} />
                  <SortHeader label="ORDER QTY" column="orderedQty" active={shortTable.sortColumn} dir={shortTable.sortDir} onSort={shortTable.changeSort} />
                  <SortHeader label="QTY SHORT" column="shortQty" active={shortTable.sortColumn} dir={shortTable.sortDir} onSort={shortTable.changeSort} />
                  <SortHeader label="REASON" column="reason" active={shortTable.sortColumn} dir={shortTable.sortDir} onSort={shortTable.changeSort} />
                </tr>
              </thead>
              <tbody>
                {shortTable.pageRows.map((r, i) => (
                  <tr key={`${r.orderId}-${r.sku}-${i}`}>
                    <td className="link">{r.orderNo}</td>
                    <td>{r.sku}</td>
                    <td>{r.pickerName}</td>
                    <td>{r.orderedQty}</td>
                    <td style={{ fontWeight: 700, color: '#DC2626' }}>{r.shortQty}</td>
                    <td>{r.reason}</td>
                  </tr>
                ))}
                {shortTable.pageRows.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                      No confirmed short picks in Zone {selected.zone}.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <Pagination page={shortTable.page} totalPages={shortTable.totalPages} onChange={shortTable.setPage} />
          </div>
        </>
      )}
    </div>
  )
}
