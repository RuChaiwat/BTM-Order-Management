'use client'

import Link from 'next/link'
import { useEffect } from 'react'

const DAY_KEY = 'btm.handheld.day'
/** Set on <html> by a screen while work must not be interrupted (the pack timer). */
export const HANDHELD_BUSY_ATTR = 'data-handheld-busy'

/** Today's date in Bangkok, YYYY-MM-DD -- the warehouse's working day, whatever the device clock zone. */
function bangkokDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * "← เมนู" link back to the Handheld menu (/handheld), plus two guards that send a Pick/Pack
 * screen back to the menu by themselves, so a device handed to the next person starts from the
 * menu and they scan their own ID:
 *   - a new day (Bangkok date), always;
 *   - no tap/scan for `idleMinutes` (Configuration > Handheld, 0 = off) -- but never while the
 *     pack timer is running (HANDHELD_BUSY_ATTR), since packing can go a long time untouched.
 * Nothing is lost either way: an open pack session lives on the server and resumes when the same
 * packer scans the same Station, ID and order again (unsent problem lines stay on the device).
 */
export function HandheldNav({ idleMinutes }: { idleMinutes: number }) {
  useEffect(() => {
    const day = bangkokDay()
    try {
      localStorage.setItem(DAY_KEY, day)
    } catch {
      /* storage blocked */
    }
    let lastActive = Date.now()
    const touch = () => {
      lastActive = Date.now()
    }
    const check = () => {
      if (bangkokDay() !== day) {
        window.location.href = '/handheld'
        return
      }
      const busy = document.documentElement.hasAttribute(HANDHELD_BUSY_ATTR)
      if (busy) lastActive = Date.now()
      else if (idleMinutes > 0 && Date.now() - lastActive >= idleMinutes * 60_000) window.location.href = '/handheld'
    }
    const activity = ['pointerdown', 'keydown', 'touchstart'] as const
    activity.forEach((e) => window.addEventListener(e, touch, { passive: true }))
    const t = setInterval(check, 30_000)
    // A device waking from sleep fires no timer catch-up, so also check when the page is shown again.
    document.addEventListener('visibilitychange', check)
    return () => {
      activity.forEach((e) => window.removeEventListener(e, touch))
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
    }
  }, [idleMinutes])

  return (
    <Link href="/handheld" className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
      ← เมนู
    </Link>
  )
}
