import { redirect } from 'next/navigation'
import { TopBar } from '@/components/TopBar'
import { ReasonMasterManager } from '@/components/admin/ReasonMasterManager'
import { PickerEmploymentTypeManager } from '@/components/admin/PickerEmploymentTypeManager'
import { ConfigEditor } from '@/components/admin/ConfigEditor'
import { ConfigHistoryPanel } from '@/components/admin/ConfigHistoryPanel'
import { HousekeepingPanel } from '@/components/admin/HousekeepingPanel'
import { createAdminClient } from '@/lib/supabase/admin'
import { getSessionUser } from '@/lib/auth'
import { CONFIG_FIELDS } from '@/lib/configCatalog'

// Every read here goes through supabase-js, which calls the global fetch() -- Next.js 14 caches
// fetch() results by default (force-cache) INDEPENDENT of whether the route renders per-request,
// so a dynamically-rendered page can still silently keep serving a stale snapshot forever. Force
// this route (and its data) to always be fresh.
export const dynamic = 'force-dynamic'

export default async function AdminPage() {
  const user = await getSessionUser()
  if (!user) redirect('/login')
  const admin = createAdminClient()

  const knownConfigKeys = CONFIG_FIELDS.map((f) => f.key)

  const [
    { data: reasons, error: reasonsError },
    { data: employmentTypes, error: employmentTypesError },
    { data: configs, error: configsError },
    { data: configVersions, error: configVersionsError },
    { data: exportJobs, error: exportError },
    { data: purgeLog, error: purgeError },
  ] = await Promise.all([
    admin.from('reason_master').select('reason_code, reason_type, label_en, label_th, active').order('reason_type').order('reason_code'),
    admin.from('picker_employment_types').select('type_code, label_en, label_th, active').order('type_code'),
    admin.from('configuration').select('key, value, version').eq('active', true).order('key'),
    // Configuration History (below) only needs the two most recent versions per known key --
    // ordering by version desc here lets it just take the first two per key in JS instead of a
    // second round trip.
    admin.from('configuration').select('key, value, version, changed_by, changed_at, change_reason').in('key', knownConfigKeys).order('key').order('version', { ascending: false }),
    // Capped well past a single page's worth (20/page in HousekeepingPanel) -- these are
    // append-only operational logs, same shape as Audit Trail, not a "last 10" preview.
    admin.from('export_jobs').select('id, status, period_start, period_end, row_count, target_ref, finished_at, error_detail').order('created_at', { ascending: false }).limit(200),
    admin.from('purge_log').select('id, covered_period_start, table_name, rows_purged, result, created_at').order('created_at', { ascending: false }).limit(200),
  ])
  for (const [label, err] of [
    ['reason_master', reasonsError],
    ['picker_employment_types', employmentTypesError],
    ['configuration', configsError],
    ['configuration_versions', configVersionsError],
    ['export_jobs', exportError],
    ['purge_log', purgeError],
  ] as const) {
    if (err) console.error(`[admin] ${label} error`, err.message)
  }

  return (
    <>
      <TopBar title="Configuration" subtitle="ตั้งค่าระบบ · Reason Master, thresholds — see Audit Trail (sidebar) for the change log" />
      <div className="page-body">
        <ReasonMasterManager reasons={reasons ?? []} />
        <PickerEmploymentTypeManager types={employmentTypes ?? []} />
        <ConfigEditor configs={configs ?? []} />
        <ConfigHistoryPanel versions={configVersions ?? []} />
        <HousekeepingPanel exportJobs={exportJobs ?? []} purgeLog={purgeLog ?? []} />
      </div>
    </>
  )
}
