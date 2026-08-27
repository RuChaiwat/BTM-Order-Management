import type { ReactNode } from 'react'

interface KpiCardProps {
  label: string
  labelTh?: string
  value: ReactNode
  valueColor?: string
  sub?: ReactNode
  subColor?: string
  compact?: boolean
  accentColor?: string
  labelColor?: string
  style?: React.CSSProperties
}

export function KpiCard({ label, labelTh, value, valueColor, sub, subColor, compact, accentColor, labelColor, style }: KpiCardProps) {
  return (
    <div
      className="kpi-card"
      style={{
        ...style,
        ...(accentColor ? { borderLeft: `3px solid ${accentColor}` } : {}),
      }}
    >
      <div className="kpi-label" style={labelColor || accentColor ? { color: labelColor ?? accentColor } : undefined}>
        {label}
      </div>
      {labelTh && <div className="kpi-label-th">{labelTh}</div>}
      <div className={`kpi-value${compact ? ' compact' : ''}`} style={valueColor ? { color: valueColor } : undefined}>
        {value}
      </div>
      {sub && (
        <div className="kpi-sub" style={subColor ? { color: subColor } : undefined}>
          {sub}
        </div>
      )}
    </div>
  )
}
