'use client'

import { useRouter } from 'next/navigation'

/** This report is opened from several different list pages (Matching Analysis & Batch Review,
 * Consolidation Pick Report, and Matching Dashboard all link to the same /pick-report/[batchId]
 * route) -- there's no single "parent" page to hardcode a link back to. router.back() walks the
 * actual browser history instead, so it always lands back on whichever page the user really
 * clicked through from, no matter which one that was. `fallbackHref` only matters if the report
 * was opened with no prior in-app history (e.g. a bookmarked/direct link, or a fresh tab). */
export function BackButton({ fallbackHref }: { fallbackHref: string }) {
  const router = useRouter()
  return (
    <button
      className="btn btn-secondary btn-sm"
      onClick={() => {
        if (window.history.length > 1) router.back()
        else router.push(fallbackHref)
      }}
    >
      ← Back
    </button>
  )
}
