import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getActiveConfig } from '@/lib/queries/config'
import { writeAudit } from '@/lib/audit'

/**
 * Weekly Picker Productivity rating (Business request) — recomputes every active picker's
 * red/yellow/green/dark-green band from their all-time average pcs/hour against a configurable
 * target (picker_productivity.target_pcs_per_hour, seeded to 4500 in migration 0020), writing
 * straight onto `pickers.productivity_level`/`productivity_pcs_per_hour`. This is the only writer
 * of those columns — Picker Management shows them but can never edit them (Business's explicit
 * ask: "ระบบจะต้องคำนวณ auto เท่านั้น").
 *
 * Triggered by Vercel Cron (vercel.json) every Sunday, same auth pattern as the other cron routes
 * (weekly-export, purge) — a manual system_admin hit works too, for testing.
 */
export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}`
  if (!isCron) {
    const user = await getSessionUser()
    if (!user || user.role !== 'system_admin') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const admin = createAdminClient()
  const cfg = await getActiveConfig(admin, ['picker_productivity.target_pcs_per_hour'])
  const targetPcsPerHour = Number(cfg.value('picker_productivity.target_pcs_per_hour') ?? 4500)

  const { data: updatedCount, error } = await admin.rpc('recompute_picker_productivity', { p_target_pcs_per_hour: targetPcsPerHour })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await writeAudit(admin, {
    userId: null,
    action: 'picker.productivity_recalc',
    entityType: 'pickers',
    after: { updated: updatedCount, target_pcs_per_hour: targetPcsPerHour },
  })

  return NextResponse.json({ updated: updatedCount, target_pcs_per_hour: targetPcsPerHour })
}
