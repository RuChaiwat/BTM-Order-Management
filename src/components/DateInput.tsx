'use client'

import type { CSSProperties } from 'react'
import { formatDate } from '@/lib/formatDate'

/** A native <input type="date"> always displays its value in the BROWSER's own locale format
 * (mm/dd/yyyy for an en-US browser, dd/mm/yyyy for en-GB, ...) -- confirmed the `lang` attribute
 * does NOT override this in Chromium, so there is no way to force the native control's own text to
 * always read DD/MM/YYYY. This keeps the native input fully functional (calendar picker, keyboard
 * entry, value/onChange) but visually hidden, and draws our own DD/MM/YYYY text on top -- matching
 * every other date shown in the app (see formatDate) regardless of the viewer's browser/OS locale. */
export function DateInput({
  value,
  onChange,
  className,
  style,
}: {
  value: string
  onChange: (value: string) => void
  className?: string
  style?: CSSProperties
}) {
  return (
    <div className={className} style={{ position: 'relative', ...style }}>
      <span style={{ pointerEvents: 'none' }}>{value ? formatDate(value) : 'DD/MM/YYYY'}</span>
      <input
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0 }}
      />
    </div>
  )
}
