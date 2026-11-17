import type { ComplexityBand } from '@/lib/queries/orderPool'
import { Legend } from '@/components/Legend'

interface Props {
  totalOrders: number
  zoneDensity: { zone: string; orderCount: number; sumQty: number }[]
  bands: Record<ComplexityBand, { count: number; sumPieces: number }>
  thresholds: { greenMinPcsPerSku: number; redMaxPcsPerSku: number }
}

const BAND_META: Record<ComplexityBand, { label: string; color: string; bg: string; desc: string }> = {
  green: { label: 'ง่าย', color: '#16A34A', bg: '#F0FDF4', desc: 'ชิ้นต่อ SKU สูง (ชิ้นเยอะ SKU น้อย)' },
  yellow: { label: 'ปานกลาง', color: '#B45309', bg: '#FFFBEB', desc: 'ชิ้นต่อ SKU ปานกลาง' },
  red: { label: 'ยาก', color: '#DC2626', bg: '#FEF2F2', desc: 'ชิ้นต่อ SKU ต่ำ (ชิ้นน้อย SKU เยอะ — เดินเยอะ)' },
}

/** Replaces the old raw "50 most recent orders" list with two decision-support breakdowns of the
 * pending pool (status = 'new'): where the volume sits by Zone, and how hard the pool will be to
 * pick, banded by pieces-per-SKU ratio. */
export function OrderPoolOverview({ totalOrders, zoneDensity, bands, thresholds }: Props) {
  const maxZoneQty = Math.max(1, ...zoneDensity.map((z) => z.sumQty))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
      <div className="card">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Order Density by Zone</span>
          <span className="card-subtitle">ความหนาแน่นของออเดอร์แต่ละโซน · {totalOrders.toLocaleString()} order</span>
        </div>
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '22%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: 120 }} />
          </colgroup>
          <thead>
            <tr>
              <th>ZONE</th>
              <th>ORDERS</th>
              <th>
                SUM
                <br />
                QTY
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            {zoneDensity.map((z) => (
              <tr key={z.zone}>
                <td style={{ fontWeight: 700 }}>Zone {z.zone}</td>
                <td>{z.orderCount.toLocaleString()}</td>
                <td>{z.sumQty.toLocaleString()}</td>
                <td style={{ width: 120 }}>
                  <div style={{ height: 10, borderRadius: 5, background: '#F3F4F6', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${(z.sumQty / maxZoneQty) * 100}%`, background: '#2563EB' }} />
                  </div>
                </td>
              </tr>
            ))}
            {zoneDensity.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
                  ยังไม่มี order ที่รอดำเนินการและระบุ Zone ได้
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-header" style={{ marginBottom: 10 }}>
          <span className="card-title">Order Complexity</span>
          <span className="card-subtitle">ความยากง่ายของออเดอร์</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(['green', 'yellow', 'red'] as const).map((band) => {
            const meta = BAND_META[band]
            const stat = bands[band]
            return (
              <div key={band} style={{ display: 'flex', alignItems: 'center', gap: 10, background: meta.bg, borderRadius: 8, padding: '10px 12px' }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: meta.color, flex: 'none' }} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: meta.color }}>{meta.label}</div>
                  <div style={{ fontSize: 11, color: '#6B7280' }}>{meta.desc}</div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 12 }}>
                  <div>
                    <strong>{stat.count.toLocaleString()}</strong> order
                  </div>
                  <div style={{ color: '#6B7280' }}>{stat.sumPieces.toLocaleString()} ชิ้น (รวม)</div>
                </div>
              </div>
            )
          })}
        </div>
        <Legend
          style={{ marginTop: 12 }}
          note="เกณฑ์ชิ้นต่อ SKU (ปรับได้ที่หน้า Configuration):"
          items={[
            { color: BAND_META.green.color, label: `ง่าย ≥ ${thresholds.greenMinPcsPerSku} ชิ้น/SKU` },
            { color: BAND_META.yellow.color, label: `ปานกลาง > ${thresholds.redMaxPcsPerSku} และ < ${thresholds.greenMinPcsPerSku} ชิ้น/SKU` },
            { color: BAND_META.red.color, label: `ยาก ≤ ${thresholds.redMaxPcsPerSku} ชิ้น/SKU` },
          ]}
        />
      </div>
    </div>
  )
}
