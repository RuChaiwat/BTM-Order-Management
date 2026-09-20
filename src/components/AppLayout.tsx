import type { ReactNode } from 'react'
import { Sidebar } from './Sidebar'
import { GlobalLoadingBar } from './GlobalLoadingBar'
import type { AppUser } from '../lib/auth'
import { createAdminClient } from '../lib/supabase/admin'

interface AppLayoutProps {
  activeNavId: number
  user: AppUser
  children: ReactNode
}

// `user` is passed in rather than fetched here -- every page already calls getSessionUser() itself
// to decide whether to redirect to /login before rendering anything, and getSessionUser() does two
// network round trips (a live auth.getUser() revalidation, then an employees_users lookup by
// auth_user_id). Having AppLayout call it AGAIN independently meant every single page paid for
// that twice, on top of middleware's own auth.getUser() call -- real, avoidable latency on every
// navigation, not just the pages with heavy data queries.
export async function AppLayout({ activeNavId, user, children }: AppLayoutProps) {
  const admin = createAdminClient()
  const [orderPool, assignable, backlog, verificationQueue] = await Promise.all([
    admin.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'new'),
    admin.from('orders').select('order_id', { count: 'exact', head: true }).in('status', ['assigned', 'in_progress']),
    admin.from('order_alerts').select('order_id', { count: 'exact', head: true }).eq('is_picking_backlog', true),
    admin.from('orders').select('order_id', { count: 'exact', head: true }).in('status', ['picker_completed_100', 'picker_completed_short']),
  ])

  const badges: Record<number, string> = {
    2: String(orderPool.count ?? 0),
    7: String(assignable.count ?? 0),
    11: String(backlog.count ?? 0),
    16: String(verificationQueue.count ?? 0),
  }

  return (
    <div className="app-shell">
      <GlobalLoadingBar />
      <Sidebar activeId={activeNavId} user={user} badges={badges} />
      <div className="app-main">{children}</div>
    </div>
  )
}
