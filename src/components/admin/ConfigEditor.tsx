'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { CONFIG_CATEGORIES, CONFIG_FIELDS, CONFIG_FIELD_BY_KEY, toDisplayValue, fromDisplayValue } from '@/lib/configCatalog'

interface ConfigRow {
  key: string
  value: unknown
  version: number
}

export function ConfigEditor({ configs }: { configs: ConfigRow[] }) {
  const router = useRouter()
  const configByKey = new Map(configs.map((c) => [c.key, c]))
  // Only edits actually in flight live here -- everything else reads straight from `configs`
  // (the server's own current value), so a save elsewhere (or router.refresh()) never leaves a
  // stale draft behind.
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})

  function displayFor(key: string): string {
    if (key in edits) return edits[key]
    const field = CONFIG_FIELD_BY_KEY.get(key)!
    return toDisplayValue(field.kind, configByKey.get(key)?.value)
  }

  function isDirty(key: string): boolean {
    if (!(key in edits)) return false
    const field = CONFIG_FIELD_BY_KEY.get(key)!
    return edits[key] !== toDisplayValue(field.kind, configByKey.get(key)?.value)
  }

  function setEdit(key: string, display: string) {
    setEdits((e) => ({ ...e, [key]: display }))
    setErrors((e) => (key in e ? { ...e, [key]: '' } : e))
  }

  function cancelEdit(key: string) {
    setEdits((e) => {
      const next = { ...e }
      delete next[key]
      return next
    })
    setErrors((e) => {
      const next = { ...e }
      delete next[key]
      return next
    })
  }

  async function save(key: string) {
    const field = CONFIG_FIELD_BY_KEY.get(key)!
    const parsed = fromDisplayValue(field.kind, edits[key] ?? '')
    if (!parsed.ok) {
      setErrors((e) => ({ ...e, [key]: 'Enter a valid number · กรอกตัวเลขให้ถูกต้อง' }))
      return
    }
    setBusyKey(key)
    const res = await fetch('/api/configuration', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, value: parsed.value }),
    })
    const body = await res.json()
    setBusyKey(null)
    if (!res.ok) {
      setErrors((e) => ({ ...e, [key]: body.error }))
      return
    }
    cancelEdit(key)
    router.refresh()
  }

  return (
    <div className="card">
      <div className="card-title">Settings</div>
      <div className="card-subtitle" style={{ marginBottom: 4 }}>
        ตั้งค่าระบบ · แก้ไขค่าแล้วกด Save เพื่อบันทึกทันที
      </div>

      {CONFIG_CATEGORIES.map((cat) => {
        const fields = CONFIG_FIELDS.filter((f) => f.category === cat.id)
        return (
          <div key={cat.id} style={{ marginTop: 20 }}>
            <div style={{ fontSize: 13, fontWeight: 700 }}>{cat.labelEn}</div>
            <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginBottom: 8 }}>{cat.labelTh}</div>
            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, overflow: 'hidden' }}>
              {fields.map((field, i) => {
                const dirty = isDirty(field.key)
                const busy = busyKey === field.key
                const error = errors[field.key]
                return (
                  <div
                    key={field.key}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      gap: 16,
                      padding: '12px 14px',
                      borderTop: i === 0 ? 'none' : '1px solid var(--color-border)',
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{field.labelEn}</div>
                      <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)' }}>{field.labelTh}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', marginTop: 4, maxWidth: 560 }}>{field.descriptionEn}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', maxWidth: 560 }}>{field.descriptionTh}</div>
                      {error && <div style={{ fontSize: 11.5, color: 'var(--color-danger)', marginTop: 4 }}>{error}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
                      <input
                        className="field-input"
                        style={{ border: '1px solid var(--color-border)', width: 90, textAlign: 'right' }}
                        value={displayFor(field.key)}
                        placeholder={field.kind === 'nullable_integer' ? 'no limit' : undefined}
                        onChange={(e) => setEdit(field.key, e.target.value)}
                        disabled={busy}
                      />
                      <span style={{ fontSize: 12, color: 'var(--color-text-secondary)', width: 52 }}>{field.unit}</span>
                      {dirty && (
                        <>
                          <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => cancelEdit(field.key)}>
                            Cancel
                          </button>
                          <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => save(field.key)}>
                            {busy ? 'Saving…' : 'Save'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
