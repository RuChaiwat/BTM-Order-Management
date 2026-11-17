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

/**
 * Pieces per hour across the whole working day (a shift runs 14-15 hours). Shows every hour from
 * the first to the last with work -- at least 8 so a short day doesn't stretch into a few fat
 * bars -- with a summary line (working window, peak hour, average per working hour). Each bar
 * shows its pieces; the hour underneath ("06" = 06:00-06:59) and the orders when given. Bars
 * size to the card, so 15-24 hours fit without scrolling.
 */
export function HourBars({ rows, color = 'var(--color-info)', unit = 'ชิ้น' }: { rows: { hour: number; value: number; orders?: number }[]; color?: string; unit?: string }) {
  const active = rows.filter((r) => r.value > 0)
  if (active.length === 0) return <div style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>ยังไม่มีข้อมูล</div>
  let first = Math.min(...active.map((r) => r.hour))
  let last = Math.max(...active.map((r) => r.hour))
  while (last - first < 7) {
    if (last < 23) last++
    if (last - first < 7 && first > 0) first--
  }
  const byHour = new Map(rows.map((r) => [r.hour, r]))
  const shown = Array.from({ length: last - first + 1 }, (_, i) => byHour.get(first + i) ?? { hour: first + i, value: 0 })
  const max = Math.max(1, ...shown.map((r) => r.value))
  const peak = active.reduce((a, b) => (b.value > a.value ? b : a))
  const workFirst = Math.min(...active.map((r) => r.hour))
  const workLast = Math.max(...active.map((r) => r.hour))
  const workHours = workLast - workFirst + 1
  const total = active.reduce((sum, r) => sum + r.value, 0)
  const dense = shown.length > 16
  const hh = (h: number) => String(h).padStart(2, '0')
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12.5, color: 'var(--color-text-secondary)' }}>
        <span>
          ช่วงทำงาน{' '}
          <b style={{ color: 'var(--color-text)' }}>
            {hh(workFirst)}:00–{hh(workLast)}:59 ({workHours} ชม.)
          </b>
        </span>
        <span>
          ชั่วโมงสูงสุด{' '}
          <b style={{ color: 'var(--color-text)' }}>
            {hh(peak.hour)}:00 ({peak.value.toLocaleString()} {unit})
          </b>
        </span>
        <span>
          เฉลี่ย <b style={{ color: 'var(--color-text)' }}>{Math.round(total / workHours).toLocaleString()}</b> {unit}/ชม.
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: dense ? 3 : 6, alignItems: 'end', height: 190, paddingTop: 4 }}>
        {shown.map((r) => (
          <div key={r.hour} title={`${hh(r.hour)}:00–${hh(r.hour)}:59 · ${r.value.toLocaleString()} ${unit}${r.orders !== undefined ? ` · ${r.orders.toLocaleString()} order` : ''}`} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'flex-end', gap: 3, height: '100%', minWidth: 0 }}>
            <span style={{ fontSize: dense ? 9.5 : 11, fontWeight: 700, whiteSpace: 'nowrap' }}>{r.value > 0 ? r.value.toLocaleString() : ''}</span>
            <div style={{ width: '100%', maxWidth: 44, height: `${(r.value / max) * 100}%`, minHeight: r.value > 0 ? 2 : 0, background: color, opacity: r.hour === peak.hour ? 1 : 0.75, borderRadius: '4px 4px 0 0' }} />
          </div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shown.length}, minmax(0, 1fr))`, gap: dense ? 3 : 6, borderTop: '1px solid var(--color-border)', paddingTop: 4 }}>
        {shown.map((r) => (
          <div key={r.hour} style={{ textAlign: 'center', fontSize: dense ? 10 : 11, lineHeight: 1.3, minWidth: 0 }}>
            <div style={{ fontWeight: 600 }}>{hh(r.hour)}</div>
            {r.orders !== undefined && <div style={{ color: 'var(--color-text-secondary)', fontSize: dense ? 9 : 10 }}>{r.orders ? r.orders.toLocaleString() : ''}</div>}
          </div>
        ))}
      </div>
      {shown.some((r) => r.orders !== undefined) && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>ตัวเลขบนแท่ง = {unit} · ใต้ชั่วโมง = จำนวน order</div>}
    </div>
  )
}
