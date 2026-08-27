'use client'

export function PrintButton() {
  return (
    <button className="btn btn-primary btn-sm" onClick={() => window.print()}>
      Print / Save as PDF
    </button>
  )
}
