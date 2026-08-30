import Link from 'next/link'
import { KpiCard } from '../KpiCard'

interface OverviewData {
  orderDate: string
  kpis: {
    totalOrders: number
    eligibleOrders: number
    matchedOrders: number
    matchRate: number
    batchesCreated: number
    singleOrders: number
    totalPieces: number
  }
  priorityBreakdown: { priority: string; batches: number; orders: number }[]
  totalGroupedOrders: number
  zoneDistribution: { zone: string; orders: number }[]
  actionRequired: { lowMatchRateBatches: number; oversizedSingleOrders: number; needsReview: number; readyToRelease: number }
  topBatches: { consol_batch_id: string; priority: string; match_pct: number | null; stores_count: number; orders_count: number; total_pieces: number; status: string }[]
}

const PRIORITY_COLOR: Record<string, string> = { P1: '#16A34A', P2: '#2563EB', P3: '#F59E0B', P4: '#DC2626' }

export function MatchingDashboardBoard({ data }: { data: OverviewData }) {
  const maxZoneOrders = Math.max(1, ...data.zoneDistribution.map((z) => z.orders))
  const hasActions =
    data.actionRequired.lowMatchRateBatches > 0 || data.actionRequired.oversizedSingleOrders > 0 || data.actionRequired.needsReview > 0 || data.actionRequired.readyToRelease > 0

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12, color: 'var(--color-text-secondary)' }}>
        Import Orders <span>→</span> Pre-screen <span>→</span> <strong style={{ color: 'var(--color-text)' }}>Matching</strong> <span>→</span> Batch Split <span>→</span> Pick Report
        <Link href="/matching-analysis" className="btn btn-primary btn-sm" style={{ marginLeft: 'auto', textDecoration: 'none' }}>
          Open Matching Analysis &amp; Batch Review →
        </Link>
      </div>

      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: 10 }}>
        <KpiCard label="TOTAL ORDERS" value={data.kpis.totalOrders} compact style={{ padding: 12 }} />
        <KpiCard label="ELIGIBLE ORDERS" value={data.kpis.eligibleOrders} valueColor="#16A34A" compact style={{ padding: 12 }} />
        <KpiCard label="MATCHED ORDERS" value={data.kpis.matchedOrders} valueColor="#7C3AED" compact style={{ padding: 12 }} />
        <KpiCard label="MATCH RATE" value={`${data.kpis.matchRate}%`} valueColor="#0891B2" compact style={{ padding: 12 }} />
        <KpiCard label="BATCHES CREATED" value={data.kpis.batchesCreated} valueColor="#EA580C" compact style={{ padding: 12 }} />
        <KpiCard label="SINGLE ORDERS" value={data.kpis.singleOrders} valueColor="#DC2626" compact style={{ padding: 12 }} />
        <KpiCard label="TOTAL PIECES" value={data.kpis.totalPieces} compact style={{ padding: 12 }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <div className="card">
          <div className="card-title">Matching by Priority</div>
          <div className="card-subtitle" style={{ marginBottom: 12 }}>
            การจับคู่ตามลำดับความสำคัญ · Order Date {data.orderDate}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {data.priorityBreakdown.map((p) => {
              const pct = data.totalGroupedOrders > 0 ? Math.round((p.orders / data.totalGroupedOrders) * 1000) / 10 : 0
              return (
                <div key={p.priority}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                    <span style={{ fontWeight: 700, color: PRIORITY_COLOR[p.priority] }}>{p.priority}</span>
                    <span>
                      {p.orders} orders · {p.batches} batch(es) ({pct}%)
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
            กระจายออเดอร์ตามโซน · lines from today's order pool
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {data.zoneDistribution.map((z) => (
              <div key={z.zone} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
                <span style={{ width: 56, fontWeight: 700 }}>Zone {z.zone}</span>
                <div style={{ flex: 1, height: 16, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
                  <span style={{ display: 'block', height: '100%', width: `${(z.orders / maxZoneOrders) * 100}%`, background: '#2563EB' }} />
                </div>
                <span style={{ width: 36, textAlign: 'right' }}>{z.orders}</span>
              </div>
            ))}
            {data.zoneDistribution.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>No order lines for this date yet.</span>}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14, flex: 1, minHeight: 0 }}>
        <div className="card" style={{ minHeight: 0 }}>
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
                    <Link href="/matching-analysis">{b.consol_batch_id.slice(0, 8)}</Link>
                  </td>
                  <td>
                    <span style={{ color: PRIORITY_COLOR[b.priority], fontWeight: 700 }}>{b.priority}</span>
                  </td>
                  <td>{b.match_pct !== null ? `${Math.round(b.match_pct * 100)}%` : '—'}</td>
                  <td>{b.stores_count}</td>
                  <td>{b.orders_count}</td>
                  <td style={{ fontWeight: 700 }}>{b.total_pieces}</td>
                  <td>{b.status}</td>
                </tr>
              ))}
              {data.topBatches.length === 0 && (
                <tr>
                  <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                    No batches for {data.orderDate} yet — run matching in Matching Analysis &amp; Batch Review.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card" style={{ minHeight: 0 }}>
          <div className="card-header">
            <span className="card-title">Action Required</span>
            <span className="card-subtitle">รายการที่ต้องดำเนินการ</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, fontSize: 12.5 }}>
            {data.actionRequired.needsReview > 0 && <ActionRow color="#F59E0B" text={`${data.actionRequired.needsReview} batch(es) awaiting review`} />}
            {data.actionRequired.readyToRelease > 0 && <ActionRow color="#16A34A" text={`${data.actionRequired.readyToRelease} batch(es) approved, ready to release`} />}
            {data.actionRequired.lowMatchRateBatches > 0 && <ActionRow color="#DC2626" text={`${data.actionRequired.lowMatchRateBatches} batch(es) with match rate < 50%`} />}
            {data.actionRequired.oversizedSingleOrders > 0 && <ActionRow color="#EA580C" text={`${data.actionRequired.oversizedSingleOrders} single order(s) over the size threshold`} />}
            {!hasActions && <span style={{ color: 'var(--color-text-secondary)' }}>Nothing needs attention for {data.orderDate}.</span>}
          </div>
          <div style={{ marginTop: 'auto', paddingTop: 12 }}>
            <Link href="/matching-analysis" className="btn btn-secondary btn-sm" style={{ width: '100%', textAlign: 'center', textDecoration: 'none', display: 'block' }}>
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
