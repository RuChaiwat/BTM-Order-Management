import { redirect } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { GlobalLoadingBar } from '@/components/GlobalLoadingBar'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Shared shell (Sidebar + loading bar) for every authenticated page, replacing the old AppLayout
 * component that each page.tsx rendered individually. That approach meant the ENTIRE shell —
 * including the sidebar — sat inside the same per-page Suspense boundary as that page's own data
 * fetch: clicking a menu item made the whole screen (sidebar included) go blank until the new
 * page's data was ready, then everything popped back in together. A real layout.tsx is a
 * persistent ancestor — it mounts once and stays mounted across client-side navigations between
 * pages that share it, so the sidebar highlights the clicked item immediately (Sidebar already
 * reads usePathname(), which Next.js updates optimistically on click, before the new page's data
 * even starts loading) while only the `{children}` slot below suspends on loading.tsx.
 */
export default async function AppShellLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

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
      <Sidebar user={user} badges={badges} />
      <div className="app-main">{children}</div>
    </div>
  )
}
