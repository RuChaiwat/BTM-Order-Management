import type { SupabaseClient } from '@supabase/supabase-js'
import { getActiveConfig } from './queries/config'

/** §13/§17 — Picking and Verification are measured against separate SLA thresholds (different
 * steps, different realistic turnaround expectations), both configurable from the Configuration
 * page instead of hardcoded. order_sla.* was seeded (migration 0003) but never actually wired to
 * anything until now; admin_verification.critical_minutes didn't exist at all (migration 0031
 * added it to complete the Warning/Overdue/Critical set for Verification, matching Picking's). */
export const SLA_CONFIG_KEYS = [
  'order_sla.warning_minutes',
  'order_sla.overdue_minutes',
  'order_sla.critical_minutes',
  'admin_verification.warning_minutes',
  'admin_verification.overdue_minutes',
  'admin_verification.critical_minutes',
]

export interface SlaThresholds {
  pickWarningMinutes: number
  pickOverdueMinutes: number
  pickCriticalMinutes: number
  verifyWarningMinutes: number
  verifyOverdueMinutes: number
  verifyCriticalMinutes: number
}

const PICKING_STATUSES = new Set(['assigned', 'in_progress'])
const VERIFICATION_STATUSES = new Set(['picker_completed_100', 'picker_completed_short'])

export async function getSlaThresholds(db: SupabaseClient): Promise<SlaThresholds> {
  const cfg = await getActiveConfig(db, SLA_CONFIG_KEYS)
  return {
    pickWarningMinutes: Number(cfg.value('order_sla.warning_minutes') ?? 45),
    pickOverdueMinutes: Number(cfg.value('order_sla.overdue_minutes') ?? 60),
    pickCriticalMinutes: Number(cfg.value('order_sla.critical_minutes') ?? 120),
    verifyWarningMinutes: Number(cfg.value('admin_verification.warning_minutes') ?? 20),
    verifyOverdueMinutes: Number(cfg.value('admin_verification.overdue_minutes') ?? 45),
    verifyCriticalMinutes: Number(cfg.value('admin_verification.critical_minutes') ?? 90),
  }
}

/** Warning/Overdue/Critical for one order, given its CURRENT pending phase's own elapsed minutes
 * (order_alerts.elapsed_minutes -- Picking: since assigned_time, Verification: since
 * picker_completed_time; see migration 0030) against that phase's own configured thresholds. An
 * order in neither phase (not yet assigned, or already closed) has nothing to alert on. */
export function computeTimeAlert(status: string, elapsedMinutes: number, t: SlaThresholds): 'warning' | 'overdue' | 'critical' | null {
  if (PICKING_STATUSES.has(status)) {
    if (elapsedMinutes >= t.pickCriticalMinutes) return 'critical'
    if (elapsedMinutes >= t.pickOverdueMinutes) return 'overdue'
    if (elapsedMinutes >= t.pickWarningMinutes) return 'warning'
    return null
  }
  if (VERIFICATION_STATUSES.has(status)) {
    if (elapsedMinutes >= t.verifyCriticalMinutes) return 'critical'
    if (elapsedMinutes >= t.verifyOverdueMinutes) return 'overdue'
    if (elapsedMinutes >= t.verifyWarningMinutes) return 'warning'
    return null
  }
  return null
}

/** Ranks an alert worst-first, for sorting a list by severity and for picking the single worst
 * alert out of a group (e.g. the whole Verification queue) to color a summary card by. */
export function alertSeverityRank(alert: 'warning' | 'overdue' | 'critical' | null): number {
  if (alert === 'critical') return 3
  if (alert === 'overdue') return 2
  if (alert === 'warning') return 1
  return 0
}
