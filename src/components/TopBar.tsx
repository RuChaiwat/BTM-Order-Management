import type { ReactNode } from 'react'

interface TopBarProps {
  title: string
  subtitle: string
  children?: ReactNode
}

export function TopBar({ title, subtitle, children }: TopBarProps) {
  return (
    <div className="topbar">
      <div>
        <div className="topbar-title">{title}</div>
        <div className="topbar-subtitle">{subtitle}</div>
      </div>
      {children && <div className="topbar-actions">{children}</div>}
    </div>
  )
}
