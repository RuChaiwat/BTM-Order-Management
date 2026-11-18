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
  /** Pinned to the bottom of the card (e.g. a "ดูรายการ →" link) so links line up across a row. */
  footer?: ReactNode
}

export function KpiCard({ label, labelTh, value, valueColor, sub, subColor, compact, accentColor, labelColor, style, footer }: KpiCardProps) {
  return (
    <div
      className="kpi-card"
      style={{
        ...(footer ? { display: 'flex', flexDirection: 'column' } : {}),
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
      {footer && <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 12 }}>{footer}</div>}
    </div>
  )
}
