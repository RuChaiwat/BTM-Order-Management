'use client'

import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

/** Code128 barcode (§15.3, §26 default symbology), rendered client-side to inline SVG.
 *
 * `displayText` overrides the human-readable text printed under the bars without changing what's
 * actually encoded — e.g. a Bin Code's barcode must encode the scannable Location ID (no dashes)
 * while still showing the dashed Location Display to a human reading the printed page (see
 * BatchReportDocument.tsx and src/lib/locations/locationDisplay.ts). */
export function Barcode({ value, displayText, height = 28, width = 1.4, fontSize = 10 }: { value: string; displayText?: string; height?: number; width?: number; fontSize?: number }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, margin: 2, displayValue: true, ...(displayText ? { text: displayText } : {}) })
    } catch {
      // invalid characters for Code128 — leave the human-readable text as fallback, don't crash the report
    }
  }, [value, displayText, height, width, fontSize])

  return <svg ref={ref} />
}
