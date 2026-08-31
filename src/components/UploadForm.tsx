'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface UploadFormProps {
  endpoint: string
  label: string
  hint: string
}

interface ImportErrorRow {
  row_number: number
  reason: string
  severity: 'blocking' | 'warning'
}

interface ImportResult {
  status: string
  orders_created: number
  orders_updated: number
  lines_upserted: number
  error_count: number
  blocking_count: number
  warning_count: number
  errors: ImportErrorRow[]
  errors_truncated: boolean
}

type Phase = 'idle' | 'uploading' | 'processing' | 'done' | 'error'

/** Uses XMLHttpRequest (not fetch) specifically so upload.onprogress can drive a real 0-100% bar
 * — fetch() has no upload-progress event. Progress tracks the file transfer only; there's no
 * signal for server-side processing time after the file lands, so that phase shows as an
 * indeterminate "Processing…" state rather than a fake number. */
export function UploadForm({ endpoint, label, hint }: UploadFormProps) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleUpload() {
    if (!file) return
    setPhase('uploading')
    setProgress(0)
    setError(null)
    setResult(null)

    const formData = new FormData()
    formData.append('file', file)

    const xhr = new XMLHttpRequest()
    xhr.open('POST', endpoint)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const pct = Math.round((e.loaded / e.total) * 100)
        setProgress(pct)
        if (pct >= 100) setPhase('processing')
      }
    }
    xhr.onload = () => {
      let body: (ImportResult & { error?: string }) | null = null
      try {
        body = JSON.parse(xhr.responseText)
      } catch {
        // fall through to the generic error below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body) {
        setResult(body)
        setPhase('done')
        router.refresh()
      } else {
        setError(body?.error ?? `Upload failed (HTTP ${xhr.status})`)
        setPhase('error')
      }
    }
    xhr.onerror = () => {
      setError('Upload failed — check your connection and try again')
      setPhase('error')
    }
    xhr.send(formData)
  }

  const busy = phase === 'uploading' || phase === 'processing'

  return (
    <div className="card">
      <div className="card-title">{label}</div>
      <div className="card-subtitle" style={{ marginBottom: 14 }}>
        {hint}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input type="file" accept=".csv,.xlsx,.xls" disabled={busy} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPhase('idle'); setResult(null); setError(null) }} />
        <button className="btn btn-primary btn-sm" disabled={!file || busy} onClick={handleUpload}>
          {busy ? 'Uploading…' : 'Upload'}
        </button>
      </div>

      {busy && (
        <div style={{ marginTop: 14 }}>
          <div style={{ height: 8, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
            <span
              style={{
                display: 'block',
                height: '100%',
                width: phase === 'processing' ? '100%' : `${progress}%`,
                background: 'var(--color-primary)',
                transition: 'width 120ms linear',
              }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>
            {phase === 'uploading' ? `กำลังอัปโหลด… ${progress}%` : 'กำลังประมวลผลข้อมูล…'}
          </div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', borderRadius: 8, padding: '10px 12px' }}>
          {error}
        </div>
      )}

      {result && phase === 'done' && (
        <div style={{ marginTop: 14 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontSize: 13,
              fontWeight: 600,
              color: result.blocking_count > 0 ? '#B45309' : '#16A34A',
              background: result.blocking_count > 0 ? '#FFFBEB' : '#F0FDF4',
              borderRadius: 8,
              padding: '10px 12px',
            }}
          >
            {result.blocking_count > 0 ? '⚠' : '✓'} นำเข้าสำเร็จ: สร้างใหม่ {result.orders_created} ออเดอร์ · อัปเดต {result.orders_updated} ออเดอร์ · {result.lines_upserted} รายการสินค้า
          </div>

          {result.error_count > 0 && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize: 12.5, color: 'var(--color-text-secondary)', marginBottom: 8 }}>
                {result.blocking_count > 0 && (
                  <div style={{ color: 'var(--color-danger)', fontWeight: 600 }}>
                    {result.blocking_count} แถวต้องแก้ไข — ยังไม่ถูกนำเข้า แก้ไขไฟล์แล้วอัปโหลดใหม่เฉพาะแถวเหล่านี้
                  </div>
                )}
                {result.warning_count > 0 && (
                  <div style={{ color: '#B45309' }}>{result.warning_count} แถวเป็นคำเตือน — นำเข้าแล้ว แต่ควรตรวจสอบ (ปล่อยผ่านได้ ไม่บังคับแก้)</div>
                )}
              </div>
              <div style={{ maxHeight: 220, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                <table className="table" style={{ margin: 0 }}>
                  <thead>
                    <tr>
                      <th style={{ width: 70 }}>แถว</th>
                      <th style={{ width: 100 }}>ประเภท</th>
                      <th>รายละเอียด</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.errors.map((e, i) => (
                      <tr key={i}>
                        <td>{e.row_number}</td>
                        <td>
                          <span className={`badge badge-${e.severity === 'blocking' ? 'danger' : 'warning'}`}>{e.severity === 'blocking' ? 'ต้องแก้ไข' : 'คำเตือน'}</span>
                        </td>
                        <td style={{ fontSize: 12 }}>{e.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {result.errors_truncated && (
                <div style={{ marginTop: 6, fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
                  แสดง {result.errors.length} จากทั้งหมด {result.error_count} รายการ — ดูรายการทั้งหมดได้จากตาราง Recent Imports ด้านล่าง
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
