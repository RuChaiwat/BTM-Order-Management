import type { ReactNode } from 'react'

export interface LegendItem {
  color: string
  label: ReactNode
}

/**
 * Colour key under a chart/table: a real colour dot + its Thai meaning, e.g.
 * <Legend items={[{ color: '#15803D', label: 'เกินเป้า' }, { color: '#DC2626', label: 'ต่ำกว่า 60%' }]} note="เป้าหมาย 300 ชิ้น/ชม." />
 */
export function Legend({ items, note, style }: { items: LegendItem[]; note?: ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 14px', fontSize: 12, color: 'var(--color-text-secondary)', ...style }}>
      {note && <span>{note}</span>}
      {items.map((item, i) => (
        <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: item.color, border: '1px solid rgba(0, 0, 0, 0.15)', flex: '0 0 auto' }} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
