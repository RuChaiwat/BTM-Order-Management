/** Horizontal bar list -- label, bar scaled to the largest value, value. Used by the Packing
 * dashboards; plain divs so it renders server-side with no chart library. */
export function BarList({ rows, color = 'var(--color-info)', unit = '', empty = '—' }: { rows: { label: string; value: number; sub?: string }[]; color?: string; unit?: string; empty?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value))
  if (rows.length === 0) return <div style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>{empty}</div>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {rows.map((r) => (
        <div key={r.label} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 38%) minmax(0, 1fr) auto', gap: 10, alignItems: 'center', fontSize: 12.5 }}>
          <span style={{ overflowWrap: 'break-word' }} title={r.label}>
            {r.label}
          </span>
          <div style={{ background: 'var(--color-surface-muted)', borderRadius: 4, height: 14, overflow: 'hidden' }}>
            <div style={{ width: `${(r.value / max) * 100}%`, height: '100%', background: color, borderRadius: 4 }} />
          </div>
          <span style={{ fontWeight: 700, minWidth: 48, textAlign: 'right' }}>
            {r.value.toLocaleString()}
            {unit}
            {r.sub && <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)', marginLeft: 4 }}>{r.sub}</span>}
          </span>
        </div>
      ))}
    </div>
  )
}

/** Vertical bars per hour of day (0-23), only the hours from the first to the last with data. */
export function HourBars({ rows, color = 'var(--color-info)' }: { rows: { hour: number; value: number }[]; color?: string }) {
  const active = rows.filter((r) => r.value > 0)
  if (active.length === 0) return <div style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>ยังไม่มีข้อมูล</div>
  const first = Math.min(...active.map((r) => r.hour))
  const last = Math.max(...active.map((r) => r.hour))
  const shown = rows.filter((r) => r.hour >= first && r.hour <= last)
  const max = Math.max(1, ...shown.map((r) => r.value))
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 160, paddingTop: 18 }}>
      {shown.map((r) => (
        <div key={r.hour} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 11, fontWeight: 700 }}>{r.value > 0 ? r.value.toLocaleString() : ''}</span>
          <div style={{ width: '100%', maxWidth: 36, height: `${(r.value / max) * 100}%`, minHeight: r.value > 0 ? 2 : 0, background: color, borderRadius: '4px 4px 0 0' }} />
          <span style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{String(r.hour).padStart(2, '0')}</span>
        </div>
      ))}
    </div>
  )
}
