'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { NAV_GROUPS } from '../data/navigation'
import type { AppUser } from '../lib/auth'
import { canAccessMenuItem, ROLE_LABELS } from '../lib/roles'
import { createClient } from '../lib/supabase/client'
import { Avatar } from './Avatar'

interface SidebarProps {
  user: AppUser
  /** live counts keyed by nav item id, computed server-side in the (app) layout — replaces any static item.badge */
  badges?: Record<number, string>
}

const COLLAPSE_KEY = 'btm.sidebar.collapsed'

export function Sidebar({ user, badges }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  // Menu groups the user has collapsed with the +/− at the top-right of each group, remembered per
  // browser (localStorage; falls back to all-expanded if storage is unavailable). The group holding
  // the current page is always shown open so the highlighted item is never hidden.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(COLLAPSE_KEY)
      if (raw) setCollapsed(new Set(JSON.parse(raw) as string[]))
    } catch {
      /* storage unavailable */
    }
  }, [])
  function toggleGroup(label: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(label)) next.delete(label)
      else next.add(label)
      try {
        window.localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
      } catch {
        /* storage unavailable */
      }
      return next
    })
  }

  async function logout() {
    if (!confirm('ต้องการออกจากระบบใช่หรือไม่?\n\nLog out of this session?')) return
    const supabase = createClient()
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  // Menu item ids are stable keys (used for role access / badges / activeNavId) but aren't
  // sequential — new items got ids appended out of visual order (e.g. Admin Verification = 16,
  // shown between Pick Completion = 8 and Zone Dashboard = 9). The number shown to the user is a
  // separate display sequence, numbered by each item's actual position in the visible menu.
  let displaySeq = 0
  const displayNumberById = new Map<number, number>()
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      if (canAccessMenuItem(user.role, item.id)) displayNumberById.set(item.id, ++displaySeq)
    }
  }

  return (
    <div className="sidebar">
      <div className="sidebar-brand">
        <div className="sidebar-brand-mark">B</div>
        <div>
          <div className="sidebar-brand-name">BEAUTRIUM</div>
          <div className="sidebar-brand-sub">Order Management</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        {NAV_GROUPS.filter((group) => group.items.some((item) => canAccessMenuItem(user.role, item.id))).map((group) => (
          <div key={group.label} className="nav-group">
            {(() => {
              const holdsCurrent = group.items.some((item) => item.path === pathname)
              const isCollapsed = collapsed.has(group.label) && !holdsCurrent
              const groupBadge = group.items.filter((item) => canAccessMenuItem(user.role, item.id)).reduce((sum, item) => sum + (Number(badges?.[item.id]) || 0), 0)
              return (
                <button type="button" className="nav-group-label nav-group-toggle" onClick={() => toggleGroup(group.label)} aria-expanded={!isCollapsed} title={isCollapsed ? 'Expand · ขยาย' : 'Collapse · ย่อ'}>
                  <span>{group.label}</span>
                  {isCollapsed && groupBadge > 0 && <span className="nav-item-badge">{groupBadge.toLocaleString()}</span>}
                  <span className="nav-group-sign">{isCollapsed ? '+' : '−'}</span>
                </button>
              )
            })()}
            {!(collapsed.has(group.label) && !group.items.some((item) => item.path === pathname)) &&
              group.items.map((item) => {
              if (!canAccessMenuItem(user.role, item.id)) return null
              const isActive = item.path === pathname
              const badge = badges?.[item.id] ?? item.badge
              const content = (
                <>
                  <span className="nav-item-label">
                    {displayNumberById.get(item.id)}. {item.en}
                    <span className="nav-item-th">{item.th}</span>
                  </span>
                  {badge && <span className="nav-item-badge">{badge}</span>}
                </>
              )
              const className = `nav-item${isActive ? ' is-active' : ''}${item.path ? '' : ' is-disabled'}`

              if (item.path && item.path !== pathname) {
                return (
                  <Link key={item.id} href={item.path} className={className}>
                    {content}
                  </Link>
                )
              }
              return (
                <div key={item.id} className={className}>
                  {content}
                </div>
              )
            })}
          </div>
        ))}
      </nav>

      <button type="button" className="sidebar-footer" onClick={logout} title="Log out">
        <Avatar name={user.name_en} seed={user.user_id} size={30} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="sidebar-footer-name">{user.name_en}</div>
          <div className="sidebar-footer-role">
            {ROLE_LABELS[user.role] ?? user.role} · {user.warehouse_code ?? '—'}
          </div>
        </div>
        <span className="sidebar-status-dot" />
      </button>
    </div>
  )
}
