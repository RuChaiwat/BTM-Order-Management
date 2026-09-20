'use client'

import { useEffect, useState } from 'react'
import { subscribeBusy } from '../lib/apiFetch'

/** Mounted once in AppLayout, shared by every page. Shows a thin animated bar at the top of the
 * screen and switches the cursor to "wait" for as long as any apiFetch() call is in flight —
 * §the "no mouse spinner while confirming" gap: there was previously no passive, always-on signal
 * that a Confirm/Assign/Final Close request was still working, only each button's own text change. */
export function GlobalLoadingBar() {
  const [busy, setBusy] = useState(false)

  useEffect(() => subscribeBusy(setBusy), [])

  useEffect(() => {
    document.body.style.cursor = busy ? 'wait' : ''
    return () => {
      document.body.style.cursor = ''
    }
  }, [busy])

  if (!busy) return null
  return (
    <div className="global-loading-bar" role="status" aria-label="Loading">
      <div className="global-loading-bar-fill" />
    </div>
  )
}
