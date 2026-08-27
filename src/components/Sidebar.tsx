'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_GROUPS } from '../data/navigation'
import type { AppUser } from '../lib/auth'
import { canAccessMenuItem, ROLE_LABELS } from '../lib/roles'

interface SidebarProps {
  /** nav item id to highlight — screens sometimes highlight an item that isn't their own route (matches the source mockups) */
  activeId: number
  user: AppUser
}

export function Sidebar({ activeId, user }: SidebarProps) {
  const pathname = usePathname()

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
          <div key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => {
              if (!canAccessMenuItem(user.role, item.id)) return null
              const isActive = item.id === activeId
              const content = (
                <>
                  <span className="nav-item-label">
                    {item.id}. {item.en}
                    <span className="nav-item-th">{item.th}</span>
                  </span>
                  {item.badge && <span className="nav-item-badge">{item.badge}</span>}
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

      <div className="sidebar-footer">
        <div className="sidebar-avatar" />
        <div style={{ flex: 1 }}>
          <div className="sidebar-footer-name">{user.name_en}</div>
          <div className="sidebar-footer-role">
            {ROLE_LABELS[user.role] ?? user.role} · {user.warehouse_code ?? '—'}
          </div>
        </div>
        <span className="sidebar-status-dot" />
      </div>
    </div>
  )
}
