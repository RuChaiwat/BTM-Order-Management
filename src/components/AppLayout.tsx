import type { ReactNode } from 'react'
import { redirect } from 'next/navigation'
import { Sidebar } from './Sidebar'
import { getSessionUser } from '../lib/auth'

interface AppLayoutProps {
  activeNavId: number
  children: ReactNode
}

export async function AppLayout({ activeNavId, children }: AppLayoutProps) {
  const user = await getSessionUser()
  if (!user) redirect('/login')

  return (
    <div className="app-shell">
      <Sidebar activeId={activeNavId} user={user} />
      <div className="app-main">{children}</div>
    </div>
  )
}
