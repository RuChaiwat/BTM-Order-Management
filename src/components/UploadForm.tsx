'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface UploadFormProps {
  endpoint: string
  label: string
  hint: string
}

export function UploadForm({ endpoint, label, hint }: UploadFormProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload() {
    if (!file) return
    setLoading(true)
    setError(null)
    setResult(null)
    const formData = new FormData()
    formData.append('file', file)
    try {
      const res = await fetch(endpoint, { method: 'POST', body: formData })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error ?? 'Upload failed')
      } else {
        setResult(body)
        router.refresh()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="card">
      <div className="card-title">{label}</div>
      <div className="card-subtitle" style={{ marginBottom: 14 }}>
        {hint}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <button className="btn btn-primary btn-sm" disabled={!file || loading} onClick={handleUpload}>
          {loading ? 'Uploading…' : 'Upload'}
        </button>
      </div>
      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', borderRadius: 8, padding: '10px 12px' }}>
          {error}
        </div>
      )}
      {result && (
        <pre style={{ marginTop: 12, fontSize: 12, background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px', overflowX: 'auto' }}>
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  )
}
