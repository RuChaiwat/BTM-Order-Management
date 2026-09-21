'use client'

import { useRef, type CSSProperties } from 'react'
import { formatDate } from '@/lib/formatDate'

/** A native <input type="date"> always displays its value in the BROWSER's own locale format
 * (mm/dd/yyyy for an en-US browser, dd/mm/yyyy for en-GB, ...) -- confirmed the `lang` attribute
 * does NOT override this in Chromium, so there is no way to force the native control's own text to
 * always read DD/MM/YYYY. This keeps the native input fully functional (calendar picker, keyboard
 * entry, value/onChange) but visually hidden, and draws our own DD/MM/YYYY text on top -- matching
 * every other date shown in the app (see formatDate) regardless of the viewer's browser/OS locale.
 *
 * Hiding the native input also hides its own calendar icon, which is otherwise the ONLY spot
 * (a ~20px sliver at the right edge) that opens the picker on click in Chromium -- clicking
 * anywhere else just focuses the (invisible) field. Drawing a visible calendar icon and calling
 * showPicker() on click anywhere in the box fixes that: the whole control is now clickable, not
 * just a hidden edge the user has to discover. */
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
  const inputRef = useRef<HTMLInputElement>(null)

  function openPicker() {
    const input = inputRef.current
    if (!input) return
    // showPicker() isn't available in every browser (Safari < 16.4) -- fall back to focusing the
    // field so keyboard entry still works even where the calendar itself can't be forced open.
    if (typeof input.showPicker === 'function') input.showPicker()
    else input.focus()
  }

  return (
    <div
      className={className}
      style={{ position: 'relative', cursor: 'pointer', justifyContent: 'space-between', ...style }}
      onClick={openPicker}
    >
      <span style={{ pointerEvents: 'none' }}>{value ? formatDate(value) : 'DD/MM/YYYY'}</span>
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ pointerEvents: 'none', flex: 'none', opacity: 0.6 }}>
        <rect x="3" y="5" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 3v4M16 3v4" />
      </svg>
      <input
        ref={inputRef}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', border: 'none', padding: 0, margin: 0 }}
      />
    </div>
  )
}
