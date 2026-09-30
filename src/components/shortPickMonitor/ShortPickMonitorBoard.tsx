'use client'

import { useMemo, useState } from 'react'
import { formatDateTime } from '@/lib/formatDate'

interface DetailRow {
  lineId: string
  orderNo: string
  storeCode: string
  zoneCode: string
  sku: string
  itemDescription: string | null
  binCode: string
  reasonLabelEn: string
  reasonLabelTh: string
  orderedQty: number
  pickedQty: number
  shortQty: number
  remark: string | null
  recordedAt: string
}

type SortKey = 'orderNo' | 'zoneCode' | 'sku' | 'reasonLabelEn' | 'shortQty' | 'recordedAt'

function sortRows(rows: DetailRow[], key: SortKey, dir: 'asc' | 'desc'): DetailRow[] {
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = a[key]
    const bv = b[key]
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: { key: SortKey; dir: 'asc' | 'desc' }; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

export function ShortPickMonitorBoard({ rows, zones, date, warehouseCode }: { rows: DetailRow[]; zones: string[]; date: string; warehouseCode: string }) {
  const [zoneFilter, setZoneFilter] = useState('ALL')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'shortQty', dir: 'desc' })

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'zoneCode' || key === 'orderNo' || key === 'sku' || key === 'reasonLabelEn' ? 'asc' : 'desc' }))
  }

  const filtered = useMemo(() => (zoneFilter === 'ALL' ? rows : rows.filter((r) => r.zoneCode === zoneFilter)), [rows, zoneFilter])
  const sorted = useMemo(() => sortRows(filtered, sort.key, sort.dir), [filtered, sort])

  const exportHref = `/api/short-pick-monitor/export?date=${encodeURIComponent(date)}${zoneFilter === 'ALL' ? '' : `&zone=${encodeURIComponent(zoneFilter)}`}`

  return (
    <div className="card" style={{ flex: 1, minHeight: 0 }}>
      <div className="card-header" style={{ marginBottom: 10 }}>
        <span className="card-title">Short / Damage / Expired Items</span>
        <span className="card-subtitle">รายการสินค้าหยิบขาด / เสียหาย / หมดอายุ · click a column to sort</span>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Zone</span>
          <select className="control" value={zoneFilter} onChange={(e) => setZoneFilter(e.target.value)}>
            <option value="ALL">All zones</option>
            {zones.map((z) => (
              <option key={z} value={z}>
                {z}
              </option>
            ))}
          </select>
        </div>
        <a className="btn btn-secondary btn-sm" href={exportHref} download>
          Export to Excel
        </a>
      </div>
      <table className="table">
        <thead>
          <tr>
            <SortHeader label="ORDER NO" sortKey="orderNo" sort={sort} onSort={toggleSort} />
            <th>STORE</th>
            <SortHeader label="ZONE" sortKey="zoneCode" sort={sort} onSort={toggleSort} />
            <SortHeader label="SKU" sortKey="sku" sort={sort} onSort={toggleSort} />
            <th>ITEM</th>
            <th>BIN</th>
            <SortHeader label="REASON" sortKey="reasonLabelEn" sort={sort} onSort={toggleSort} />
            <th>ORDERED</th>
            <th>PICKED</th>
            <SortHeader label="SHORT" sortKey="shortQty" sort={sort} onSort={toggleSort} />
            <SortHeader label="RECORDED" sortKey="recordedAt" sort={sort} onSort={toggleSort} />
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.lineId}>
              <td style={{ fontWeight: 700 }}>{r.orderNo}</td>
              <td>{r.storeCode}</td>
              <td>{r.zoneCode}</td>
              <td>{r.sku}</td>
              <td>{r.itemDescription ?? '—'}</td>
              <td>{r.binCode}</td>
              <td>
                {r.reasonLabelEn} <span style={{ color: '#6B7280' }}>({r.reasonLabelTh})</span>
              </td>
              <td>{r.orderedQty}</td>
              <td>{r.pickedQty}</td>
              <td style={{ fontWeight: 700, color: '#F59E0B' }}>{r.shortQty}</td>
              <td>{formatDateTime(r.recordedAt)}</td>
            </tr>
          ))}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={11} style={{ color: 'var(--color-text-secondary)' }}>
                No short/damage/expired items for {warehouseCode} on this date{zoneFilter === 'ALL' ? '' : ` in zone ${zoneFilter}`}.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}
