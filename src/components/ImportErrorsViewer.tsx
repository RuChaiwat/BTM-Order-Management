'use client'

import { useState } from 'react'

interface ErrorRow {
  error_id: string
  row_number: number
  error_reason: string
  severity: 'blocking' | 'warning'
}

/** Expands a Recent Imports row to show what went wrong — fetched on demand so the page itself
 * doesn't have to pull every historical import's error rows up front. */
export function ImportErrorsViewer({ importId, errorCount }: { importId: string; errorCount: number }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<ErrorRow[] | null>(null)

  async function toggle() {
    if (open) {
      setOpen(false)
      return
    }
    setOpen(true)
    if (errors) return
    setLoading(true)
    const res = await fetch(`/api/imports/${importId}/errors`)
    const body = await res.json()
    setErrors(res.ok ? body.errors : [])
    setLoading(false)
  }

  if (errorCount === 0) return <span style={{ color: '#9CA3AF' }}>0</span>

  return (
    <div>
      <button className="link" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit' }} onClick={toggle}>
        {errorCount} {open ? '▲' : '▼'}
      </button>
      {open && (
        <div style={{ marginTop: 8, maxHeight: 200, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8, minWidth: 320 }}>
          {loading && <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>Loading…</div>}
          {!loading && errors && errors.length === 0 && <div style={{ padding: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>No error detail found.</div>}
          {!loading &&
            errors?.map((e) => (
              <div key={e.error_id} style={{ padding: '6px 10px', fontSize: 11.5, borderBottom: '1px solid var(--color-border)' }}>
                <span className={`badge badge-${e.severity === 'blocking' ? 'danger' : 'warning'}`} style={{ marginRight: 6 }}>
                  {e.severity === 'blocking' ? 'ต้องแก้ไข' : 'คำเตือน'}
                </span>
                Row {e.row_number}: {e.error_reason}
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
