import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { getSessionUser } from '../lib/auth'
import { createAdminClient } from '../lib/supabase/admin'

interface AppLayoutProps {
  activeNavId: number
  children: ReactNode
}

export async function AppLayout({ activeNavId, children }: AppLayoutProps) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  const admin = createAdminClient()
  const [orderPool, assignable, backlog] = await Promise.all([
    admin.from('orders').select('order_id', { count: 'exact', head: true }).eq('status', 'new'),
    admin.from('orders').select('order_id', { count: 'exact', head: true }).in('status', ['assigned', 'in_progress']),
    admin.from('order_alerts').select('order_id', { count: 'exact', head: true }).eq('is_picking_backlog', true),
  ])

  const badges: Record<number, string> = {
    2: String(orderPool.count ?? 0),
    7: String(assignable.count ?? 0),
    11: String(backlog.count ?? 0),
  }

  return (
    <div className="app-shell">
      <Sidebar activeId={activeNavId} user={user} badges={badges} />
      <div className="app-main">{children}</div>
    </div>
  )
}
