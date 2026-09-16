export type ProductivityLevel = 'above_target' | 'target' | 'yellow' | 'red'

/** Weekly auto-computed Picker Productivity rating (migration 0020) -- red/yellow/green/dark-green
 * banding of a picker's all-time average pcs/hour against a configurable target, recomputed every
 * Sunday by /api/cron/picker-productivity. Never set by hand. `null` means no completions yet
 * (new picker), shown as gray rather than any of the four bands. */
export const PRODUCTIVITY_LEVEL_META: Record<ProductivityLevel, { label: string; color: string; bg: string }> = {
  above_target: { label: 'Above Target', color: '#166534', bg: '#DCFCE7' },
  target: { label: 'Target', color: '#16A34A', bg: '#F0FDF4' },
  yellow: { label: 'Below Target', color: '#B45309', bg: '#FFFBEB' },
  red: { label: 'Low', color: '#DC2626', bg: '#FEF2F2' },
}

export const PRODUCTIVITY_NO_DATA_META = { label: 'No data yet', color: '#6B7280', bg: '#F3F4F6' }

export function productivityMeta(level: string | null) {
  return level && level in PRODUCTIVITY_LEVEL_META ? PRODUCTIVITY_LEVEL_META[level as ProductivityLevel] : PRODUCTIVITY_NO_DATA_META
}
