'use client'

import Link from 'next/link'
import { useEffect } from 'react'

const DAY_KEY = 'btm.handheld.day'

/** Today's date in Bangkok, YYYY-MM-DD -- the warehouse's working day, whatever the device clock zone. */
function bangkokDay() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}

/**
 * "← เมนู" link back to the Handheld menu (/handheld) plus the day guard: a Pick or Pack screen
 * left open past midnight goes back to the menu by itself. Nothing is lost -- an open pack session
 * lives on the server and resumes when the packer scans the same Station, ID and order again
 * (unsent problem lines are kept on the device by session). On Pick Completion only quantities
 * typed but not yet saved at that moment would need re-entering (client accepted).
 */
export function HandheldNav() {
  useEffect(() => {
    let day: string
    try {
      day = bangkokDay()
      localStorage.setItem(DAY_KEY, day)
    } catch {
      day = bangkokDay()
    }
    const check = () => {
      if (bangkokDay() !== day) window.location.href = '/handheld'
    }
    const t = setInterval(check, 60_000)
    // A device waking from sleep fires no timer catch-up, so also check when the page is shown again.
    document.addEventListener('visibilitychange', check)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
    }
  }, [])

  return (
    <Link href="/handheld" className="btn btn-secondary btn-sm" style={{ whiteSpace: 'nowrap' }}>
      ← เมนู
    </Link>
  )
}
