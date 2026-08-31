'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseSpreadsheet, orderGroupKey } from '@/lib/importers/parseSpreadsheet'

const ORDERS_PER_BATCH = 5

interface ErrorRow {
  row_number: number
  reason: string
  severity: 'blocking' | 'warning'
}

interface ImportSummary {
  status: string
  orders_created: number
  orders_updated: number
  lines_upserted: number
  error_count: number
  blocking_count: number
  warning_count: number
  errors: ErrorRow[]
  errors_truncated: boolean
}

type Phase = 'idle' | 'parsing' | 'importing' | 'finishing' | 'done' | 'error'

/**
 * Order import gets its own form (rather than the generic UploadForm) because it needs REAL
 * progress, not just upload-transfer %. A small file uploads to the server almost instantly, but
 * the actual work — validating and writing each order/line — happens after that and used to show
 * as a stuck 100% bar with no feedback. This parses the file in the browser, chunks it into small
 * order-group batches (an order's lines always stay in one batch), and POSTs one batch at a time
 * so progress = batches completed / total batches — a real signal tied to the slow part.
 */
export function OrderImportForm({ endpointBase, hint }: { endpointBase: string; hint: string }) {
  const router = useRouter()
  const [file, setFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)

  const busy = phase === 'parsing' || phase === 'importing' || phase === 'finishing'

  async function handleUpload() {
    if (!file) return
    setPhase('parsing')
    setProgress(0)
    setError(null)
    setResult(null)

    try {
      const rows = await parseSpreadsheet(file)
      if (rows.length === 0) throw new Error('File has no data rows')
      const rawRows = rows.map((data, i) => ({ rowNumber: i + 2, data }))

      const groups = new Map<string, typeof rawRows>()
      for (const r of rawRows) {
        const key = orderGroupKey(r.data)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(r)
      }
      const groupKeys = [...groups.keys()]
      const batches: (typeof rawRows)[] = []
      for (let i = 0; i < groupKeys.length; i += ORDERS_PER_BATCH) {
        batches.push(groupKeys.slice(i, i + ORDERS_PER_BATCH).flatMap((k) => groups.get(k)!))
      }

      const startRes = await fetch(`${endpointBase}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: file.name, total_rows: rows.length }),
      })
      const startBody = await startRes.json()
      if (!startRes.ok) throw new Error(startBody.error)
      const importId = startBody.import_id as string

      setPhase('importing')
      let ordersCreated = 0
      let ordersUpdated = 0
      let linesUpserted = 0
      const allErrors: ErrorRow[] = []

      for (let i = 0; i < batches.length; i++) {
        const res = await fetch(`${endpointBase}/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ import_id: importId, rows: batches[i] }),
        })
        const body = await res.json()
        if (!res.ok) throw new Error(body.error)
        ordersCreated += body.orders_created
        ordersUpdated += body.orders_updated
        linesUpserted += body.lines_upserted
        allErrors.push(...body.errors)
        setProgress(Math.round(((i + 1) / batches.length) * 100))
      }

      setPhase('finishing')
      const finishRes = await fetch(`${endpointBase}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_id: importId, orders_created: ordersCreated, orders_updated: ordersUpdated, lines_upserted: linesUpserted }),
      })
      const finishBody = await finishRes.json()
      if (!finishRes.ok) throw new Error(finishBody.error)

      const blockingCount = allErrors.filter((e) => e.severity === 'blocking').length
      setResult({
        status: finishBody.status,
        orders_created: ordersCreated,
        orders_updated: ordersUpdated,
        lines_upserted: linesUpserted,
        error_count: allErrors.length,
        blocking_count: blockingCount,
        warning_count: allErrors.length - blockingCount,
        errors: allErrors.slice(0, 100),
        errors_truncated: allErrors.length > 100,
      })
      setPhase('done')
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  const barLabel = phase === 'parsing' ? 'กำลังอ่านไฟล์…' : phase === 'importing' ? `กำลังนำเข้า… ${progress}%` : phase === 'finishing' ? 'กำลังสรุปผล…' : ''
  const barWidth = phase === 'importing' ? progress : phase === 'parsing' || phase === 'finishing' ? 100 : 0
  const indeterminate = phase === 'parsing' || phase === 'finishing'

  return (
    <div className="card">
      <div className="card-title">Import WMS orders</div>
      <div className="card-subtitle" style={{ marginBottom: 14 }}>
        {hint}
      </div>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <input
          type="file"
          accept=".csv,.xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPhase('idle')
            setResult(null)
            setError(null)
          }}
        />
        <button className="btn btn-primary btn-sm" disabled={!file || busy} onClick={handleUpload}>
          {busy ? 'Importing…' : 'Upload'}
        </button>
      </div>

      {busy && (
        <div style={{ marginTop: 14 }}>
          <div className={indeterminate ? 'progress-track indeterminate' : 'progress-track'} style={{ height: 8, borderRadius: 4, background: '#F3F4F6', overflow: 'hidden' }}>
            <span
              className={indeterminate ? 'progress-fill indeterminate' : undefined}
              style={{ display: 'block', height: '100%', width: `${barWidth}%`, background: 'var(--color-primary)', transition: 'width 200ms linear' }}
            />
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-text-secondary)' }}>{barLabel}</div>
        </div>
      )}

      {error && (
        <div style={{ marginTop: 12, fontSize: 12.5, color: 'var(--color-danger)', background: 'var(--color-danger-bg)', borderRadius: 8, padding: '10px 12px' }}>{error}</div>
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
                {result.warning_count > 0 && <div style={{ color: '#B45309' }}>{result.warning_count} แถวเป็นคำเตือน — นำเข้าแล้ว แต่ควรตรวจสอบ (ปล่อยผ่านได้ ไม่บังคับแก้)</div>}
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
