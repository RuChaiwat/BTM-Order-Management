'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

const DEFAULT_INTERVAL_MS = 5 * 60_000

/** Silently re-fetches this page's server data every `intervalMs` (default 5 min) via
 * router.refresh() -- for a dashboard/report page left open on a wall monitor or a background tab,
 * so it stays current without anyone reloading it by hand. Only re-runs this route's Server
 * Components with fresh props; it doesn't remount anything, so an already-open Modal or a
 * half-typed filter on the page is untouched. Not used on data-entry/action screens (Work
 * Assignment, Pick Completion, Admin Verification, Configuration, etc) -- those already refresh
 * themselves right after the action that changes their own data, and a mid-task background
 * refresh there would be surprising rather than helpful. */
export function AutoRefresh({ intervalMs = DEFAULT_INTERVAL_MS }: { intervalMs?: number }) {
  const router = useRouter()
  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs)
    return () => clearInterval(id)
  }, [router, intervalMs])
  return null
}
