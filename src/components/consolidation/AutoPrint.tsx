'use client'

import { useEffect } from 'react'

/** Fires the browser print dialog as soon as the multi-batch print page has rendered — this page
 * is only ever opened right after a bulk Approve, so there's nothing for the user to review first. */
export function AutoPrint() {
  useEffect(() => {
    window.print()
  }, [])
  return null
}
