/**
 * Shared red/yellow/green severity palette for order time-alerts (Warning/Overdue/Critical) and
 * zone/picker risk levels, used identically everywhere this app shows one of these states instead
 * of each screen defining its own copy — which had drifted at least once already (an "Overdue" KPI
 * tile used a distinct dark orange while its own Warning/Overdue/Critical badges and every other
 * page's Overdue used the same yellow as Warning). Overdue intentionally renders the SAME color as
 * Warning (one tier short of the full 3-level breakdown) everywhere a plain 3-color read is wanted.
 *
 * Not every orange/red in the app is one of these severities — e.g. Matching Dashboard's
 * "oversized single orders" action row is a size-threshold warning, a different concept that only
 * coincidentally used the same hex value in one place; it's intentionally NOT wired to this file.
 */
export const ALERT_COLOR: Record<'critical' | 'overdue' | 'warning', string> = {
  critical: '#DC2626',
  overdue: '#F59E0B',
  warning: '#F59E0B',
}

export const ALERT_LABEL_COLOR: Record<'critical' | 'overdue' | 'warning', string> = {
  critical: '#DC2626',
  overdue: '#B45309',
  warning: '#B45309',
}

export const ALERT_BADGE_TONE: Record<'critical' | 'overdue' | 'warning', string> = {
  critical: 'danger',
  overdue: 'warning',
  warning: 'warning',
}

/** Zone Status / Zone Dashboard's own red/yellow/green risk level (worst time-alert among active
 * orders in that zone). */
export const RISK_COLOR: Record<'red' | 'yellow' | 'green', string> = {
  red: '#DC2626',
  yellow: '#F59E0B',
  green: '#16A34A',
}

/** Matching priority tiers (P1 highest match confidence -> P4 lowest). */
export const PRIORITY_COLOR: Record<string, string> = {
  P1: '#16A34A',
  P2: '#2563EB',
  P3: '#F59E0B',
  P4: '#DC2626',
}
