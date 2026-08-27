'use client'

import { useEffect, useRef } from 'react'
import JsBarcode from 'jsbarcode'

/** Code128 barcode (§15.3, §26 default symbology), rendered client-side to inline SVG. */
export function Barcode({ value, height = 28, width = 1.4, fontSize = 10 }: { value: string; height?: number; width?: number; fontSize?: number }) {
  const ref = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!ref.current || !value) return
    try {
      JsBarcode(ref.current, value, { format: 'CODE128', height, width, fontSize, margin: 2, displayValue: true })
    } catch {
      // invalid characters for Code128 — leave the human-readable text as fallback, don't crash the report
    }
  }, [value, height, width, fontSize])

  return <svg ref={ref} />
}
