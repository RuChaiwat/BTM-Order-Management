import { redirect } from 'next/navigation'
import Link from 'next/link'
import { AppLayout } from '@/components/AppLayout'
import { TopBar } from '@/components/TopBar'
import { getSessionUser } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'

export default async function ConsolidationHistoryPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const supabase = await createClient()

  const { data: batches } = await supabase
    .from('consolidation_batches')
    .select('consol_batch_id, order_date, priority, stores_count, orders_count, total_pieces, status, released_at, created_at')
    .in('status', ['report_released', 'picking', 'at_consolidation', 'sorting', 'completed', 'cancelled'])
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <AppLayout activeNavId={6}>
      <TopBar title="Consolidation History" subtitle="ประวัติการรวมออเดอร์ · released, completed and cancelled batches" />
      <div className="page-body">
        <div className="card" style={{ flex: 1, minHeight: 0 }}>
          <table className="table">
            <thead>
              <tr>
                <th>BATCH</th>
                <th>ORDER DATE</th>
                <th>PRIORITY</th>
                <th>STORES</th>
                <th>ORDERS</th>
                <th>PIECES</th>
                <th>RELEASED</th>
                <th>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {(batches ?? []).map((b) => (
                <tr key={b.consol_batch_id}>
                  <td className="link">
                    <Link href={`/pick-report/${b.consol_batch_id}`}>{b.consol_batch_id.slice(0, 8)}</Link>
                  </td>
                  <td>{b.order_date}</td>
                  <td>{b.priority}</td>
                  <td>{b.stores_count}</td>
                  <td>{b.orders_count}</td>
                  <td>{b.total_pieces}</td>
                  <td>{b.released_at ? new Date(b.released_at).toLocaleString() : '—'}</td>
                  <td>
                    <span className="badge badge-neutral">{b.status}</span>
                  </td>
                </tr>
              ))}
              {(!batches || batches.length === 0) && (
                <tr>
                  <td colSpan={8} style={{ color: 'var(--color-text-secondary)' }}>
                    No released or completed batches yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </AppLayout>
  )
}
