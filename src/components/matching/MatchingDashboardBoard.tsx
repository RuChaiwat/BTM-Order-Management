import Link from 'next/link'
import { KpiCard } from '../KpiCard'
import { batchStatusLabel } from '@/lib/matching/batchStatus'
import { formatDate } from '@/lib/formatDate'

interface OverviewData {
  orderDate: string
  kpis: {
    totalOrders: number
    totalPieces: number
    eligibleOrders: number
    eligiblePieces: number
    matchedOrders: number
    matchedPieces: number
    matchRatePieces: number
    matchRateOrders: number
    batchesCreated: number
    singleOrders: number
    approvedOrders: number
    approvedPieces: number
    completedOrders: number
    completedPieces: number
    pendingOrders: number
    pendingPieces: number
  }
  priorityBreakdown: { priority: string; batches: number; orders: number; pieces: number }[]
  totalGroupedOrders: number
  zoneDistribution: { zone: string; pieces: number }[]
  actionRequired: { lowMatchRateBatches: number; oversizedSingleOrders: number; awaitingApproval: number }
  topBatches: { consol_batch_id: string; batch_no: string; priority: string; match_pct: number | null; stores_count: number; orders_count: number; total_pieces: number; status: string }[]
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#16A34A', P2: '#2563EB', P3: '#F59E0B', P4: '#DC2626' }

export function MatchingDashboardBoard({ data }: { data: OverviewData }) {
  const maxZonePieces = Math.max(1, ...data.zoneDistribution.map((z) => z.pieces))
  const hasActions = data.actionRequired.lowMatchRateBatches > 0 || data.actionRequired.oversizedSingleOrders > 0 || data.actionRequired.awaitingApproval > 0

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        Import Orders <span>→</span> Pre-screen <span>→</span> <strong style={{ color: 'var(--color-text)' }}>Matching</strong> <span>→</span> Batch Split <span>→</span> Pick Report
        <Link href="/matching-analysis" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          Open Matching Analysis &amp; Batch Review →
        </Link>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(6, 1fr)', gap: 10 }}>
        <KpiCard
          label="TOTAL ORDERS (PCS)"
          labelTh="ออเดอร์ทั้งหมดที่ Import"
          value={data.kpis.totalPieces.toLocaleString()}
          sub={`${data.kpis.totalOrders.toLocaleString()} orders`}
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="ELIGIBLE ORDERS (PCS)"
          labelTh="ออเดอร์ที่พร้อมจับคู่"
          value={data.kpis.eligiblePieces.toLocaleString()}
          valueColor="#16A34A"
          sub={`${data.kpis.eligibleOrders.toLocaleString()} orders`}
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="MATCHED ORDERS (PCS)"
          labelTh="ออเดอร์ที่จับคู่แล้ว"
          value={data.kpis.matchedPieces.toLocaleString()}
          valueColor="#7C3AED"
          sub={`${data.kpis.matchedOrders.toLocaleString()} orders`}
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="MATCH RATE"
          labelTh="% การจับคู่สำเร็จ (ชิ้น)"
          value={`${data.kpis.matchRatePieces}%`}
          valueColor="#0891B2"
          sub={`${data.kpis.matchRateOrders}% by order count`}
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="BATCHES CREATED"
          labelTh="แบตช์ที่สร้างแล้ว"
          value={data.kpis.batchesCreated.toLocaleString()}
          valueColor="#EA580C"
          sub="batches"
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="SINGLE ORDERS"
          labelTh="ออเดอร์เดี่ยว (ไม่จับคู่)"
          value={data.kpis.singleOrders.toLocaleString()}
          valueColor="#DC2626"
          sub="orders"
          compact
          style={{ padding: 12 }}
        />
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
        <KpiCard
          label="ORDERS APPROVED (PCS)"
          labelTh="ออเดอร์ที่อนุมัติแล้ว"
          value={data.kpis.approvedPieces.toLocaleString()}
          valueColor="#2563EB"
          sub={`${data.kpis.approvedOrders.toLocaleString()} orders`}
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="ORDERS COMPLETED (PCS)"
          labelTh="ออเดอร์ที่เสร็จสิ้นแล้ว"
          value={data.kpis.completedPieces.toLocaleString()}
          valueColor="#16A34A"
          sub={`${data.kpis.completedOrders.toLocaleString()} orders`}
          compact
          style={{ padding: 12 }}
        />
        <KpiCard
          label="ORDERS PENDING (PCS)"
          labelTh="ออเดอร์ที่รอดำเนินการ"
          value={data.kpis.pendingPieces.toLocaleString()}
          valueColor={data.kpis.pendingPieces > 0 ? '#F59E0B' : undefined}
          sub={`${data.kpis.pendingOrders.toLocaleString()} orders`}
          compact
          style={{ padding: 12 }}
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-title">Matching by Priority</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            การจับคู่ตามลำดับความสำคัญ · Order Date {formatDate(data.orderDate)}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.priorityBreakdown.map((p) => {
              const pct = data.totalGroupedOrders > 0 ? Math.round((p.orders / data.totalGroupedOrders) * 1000) / 10 : 0
              return (
                <div key={p.priority}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: PRIORITY_COLOR[p.priority] }}>{p.priority}</span>
                    <span>
                      {p.orders} orders · {p.pieces.toLocaleString()} pcs · {p.batches} batch(es) ({pct}%)
                    </span>
                  </div>
                  <div style={{ height: 8, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
                    <span style={{ display: 'block', height: '100%', width: `${pct}%`, background: PRIORITY_COLOR[p.priority] }} />
                  </div>
                </div>
              )
            })}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, paddingTop: 4, borderTop: '1px solid var(--color-border)' }}>
              <span style={{ color: '#6B7280' }}>Single Order (no group)</span>
              <span>{data.kpis.singleOrders} orders</span>
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-title">Order Distribution by Zone</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            กระจายออเดอร์ตามโซน (ชิ้น) · matched orders only · zones an order touches, don&apos;t sum across zones
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.zoneDistribution.map((z) => (
              <div key={z.zone} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 56, fontWeight: 700 }}>Zone {z.zone}</span>
                <div style={{ flex: 1, height: 16, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(z.pieces / maxZonePieces) * 100}%`, background: '#2563EB' }} />
                </div>
                <span style={{ width: 70, textAlign: 'right' }}>{z.pieces.toLocaleString()} pcs</span>
              </div>
            ))}
            {data.zoneDistribution.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>No order lines for this date yet.</span>}
          </div>
        </div>
      </div>

      {/* No minHeight:0 anywhere below -- .app-shell is a fixed 100vh flex column, so a flex item
          allowed to shrink below its content gets squeezed by the flex algorithm once total page
          content exceeds the viewport, and .card has no overflow:hidden of its own, so a table's
          overflow rows spill out past the card's bottom edge instead of the page just scrolling
          (same fix as Zone Dashboard/Control Tower). */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, flex: 1 }}>
        <div className="card">
          <div className="card-header" style={{ marginBottom: 10 }}>
            <span className="card-title">Top Batches</span>
            <span className="card-subtitle">ranked by pieces</span>
            <Link href="/matching-analysis" className="link" style={{ marginLeft: 'auto', fontSize: 12.5 }}>
              View all →
            </Link>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>BATCH</th>
                <th>PRIORITY</th>
                <th>MATCH %</th>
                <th>STORES</th>
                <th>ORDERS</th>
                <th>PIECES</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {data.topBatches.map((b) => (
                <tr key={b.consol_batch_id}>
                  <td className="link">
                    <Link href={`/pick-report/${b.consol_batch_id}`}>{b.batch_no}</Link>
                  </td>
                  <td>
                    <span style={{ color: PRIORITY_COLOR[b.priority], fontWeight: 700 }}>{b.priority}</span>
                  </td>
                  <td>{b.match_pct !== null ? `${Math.round(b.match_pct * 100)}%` : '—'}</td>
                  <td>{b.stores_count}</td>
                  <td>{b.orders_count}</td>
                  <td style={{ fontWeight: 700 }}>{b.total_pieces}</td>
                  <td>{batchStatusLabel(b.status)}</td>
                </tr>
              ))}
              {data.topBatches.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                    No batches for {formatDate(data.orderDate)} yet — run matching in Matching Analysis &amp; Batch Review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card">
          <div className="card-header">
            <span className="card-title">Action Required</span>
            <span className="card-subtitle">รายการที่ต้องดำเนินการ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
            {data.actionRequired.awaitingApproval > 0 && <ActionRow color="#F59E0B" text={`${data.actionRequired.awaitingApproval} batch(es) awaiting approval`} />}
            {data.actionRequired.lowMatchRateBatches > 0 && <ActionRow color="#DC2626" text={`${data.actionRequired.lowMatchRateBatches} batch(es) with match rate < 50%`} />}
            {data.actionRequired.oversizedSingleOrders > 0 && <ActionRow color="#EA580C" text={`${data.actionRequired.oversizedSingleOrders} single order(s) over the size threshold`} />}
            {!hasActions && <span style={{ color: 'var(--color-text-secondary)' }}>Nothing needs attention for {formatDate(data.orderDate)}.</span>}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 12 }}>
            <Link
              href="/matching-analysis"
              className="btn btn-primary btn-sm"
              style={{ width: '100%', textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              Review &amp; act on batches
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}

function ActionRow({ color, text }: { color: string; text: string }) {
  return (
    <div style={{ display: 'flex', gap: 10 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, marginTop: 5, flex: 'none' }} />
      <div style={{ flex: 1 }}>{text}</div>
    </div>
  )
}
