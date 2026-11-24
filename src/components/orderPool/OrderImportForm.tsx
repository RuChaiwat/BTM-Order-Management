'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { parseWmsOrderFiles, orderGroupKey, SOURCE_ROW } from '@/lib/importers/parseSpreadsheet'
import { Pagination } from '@/components/Pagination'
import { formatDateTime } from '@/lib/formatDate'

// processOrderRowsBatch now does a small constant number of DB round trips per HTTP call
// (bulk order lookup/insert/line-upsert/re-aggregate) instead of one round trip per order or per
// line, so this can be much larger than before without each HTTP call getting slower per-order --
// it mainly trades off "fewer, larger requests" against very long .in() filter lists (distinct Bin
// Codes in one call) and per-request serverless duration. 50 is a first cut for WMS Transfer Order
// volume (~15-20k lines/day); tune down if a batch call is timing out, up if requests still feel
// numerous.
const ORDERS_PER_BATCH = 50

interface ErrorRow {
  row_number: number
  reason: string
  severity: 'blocking' | 'warning'
}

interface ImportSummary {
  file_name: string
  uploaded_at: string
  total_rows: number
  success_rows: number
  status: string
  orders_created: number
  orders_updated: number
  orders_locked: number
  lines_upserted: number
  error_count: number
  blocking_count: number
  warning_count: number
  errors: ErrorRow[]
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
  // The two WMS reports are uploaded as separate files (no longer two sheets of one workbook).
  const [transferFile, setTransferFile] = useState<File | null>(null)
  const [pickLinesFile, setPickLinesFile] = useState<File | null>(null)
  const [phase, setPhase] = useState<Phase>('idle')
  const [progress, setProgress] = useState(0)
  const [result, setResult] = useState<ImportSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  // Bumped after a successful import to remount both <input type="file">s — a file input's
  // displayed filename can't be cleared via its `value` (read-only), only by remounting it.
  const [inputKey, setInputKey] = useState(0)

  const busy = phase === 'parsing' || phase === 'importing' || phase === 'finishing'

  async function handleUpload() {
    if (!transferFile || !pickLinesFile) return
    setPhase('parsing')
    setProgress(0)
    setError(null)
    setResult(null)

    try {
      const rows = await parseWmsOrderFiles(transferFile, pickLinesFile)
      if (rows.length === 0) throw new Error('ไม่พบรายการ Order สถานะ Picking — ตรวจ BT Status ในไฟล์ Transfer List และดูว่าไฟล์ Warehouse Pick Lines มี Source No. ที่ตรงกัน')
      // Row number = the row in the Warehouse Pick Lines file (not the position after filtering).
      const rawRows = rows.map((data, i) => ({ rowNumber: Number(data[SOURCE_ROW]) || i + 2, data }))

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
        body: JSON.stringify({ file_name: `${transferFile.name} + ${pickLinesFile.name}`, total_rows: rows.length }),
      })
      const startBody = await startRes.json()
      if (!startRes.ok) throw new Error(startBody.error)
      const importId = startBody.import_id as string

      setPhase('importing')
      let ordersCreated = 0
      let ordersUpdated = 0
      let ordersLocked = 0
      let linesUpserted = 0
      const allErrors: ErrorRow[] = []

      // One batch call failing outright (a Vercel function timeout on an unusually large batch, a
      // dropped connection, ...) used to throw and abort the whole loop, silently leaving every
      // later batch's orders un-imported with no error shown for any of their rows -- exactly the
      // "1494 in the file, 950 created" shape of bug. Now a failed batch gets one retry, and if it
      // still fails, is recorded as a blocking error for each of ITS rows (persisted to the DB, not
      // just shown in this browser tab) and the loop moves on, so one bad batch only costs its own
      // rows instead of every batch after it.
      for (let i = 0; i < batches.length; i++) {
        let body: { orders_created: number; orders_updated: number; orders_locked: number; lines_upserted: number; errors: ErrorRow[] } | null = null
        let lastError: Error | null = null
        for (let attempt = 0; attempt < 2 && !body; attempt++) {
          try {
            const res = await fetch(`${endpointBase}/batch`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ import_id: importId, rows: batches[i] }),
            })
            const parsed = await res.json()
            if (!res.ok) throw new Error(parsed.error)
            body = parsed
          } catch (e) {
            lastError = e as Error
          }
        }
        if (body) {
          ordersCreated += body.orders_created
          ordersUpdated += body.orders_updated
          ordersLocked += body.orders_locked ?? 0
          linesUpserted += body.lines_upserted
          allErrors.push(...body.errors)
        } else {
          const reason = `นำเข้าข้อมูลชุดนี้ไม่สำเร็จ: ${lastError?.message ?? 'ไม่ทราบสาเหตุ'} — ข้อมูลชุดนี้ยังไม่ถูกนำเข้า กรุณา upload ไฟล์ใหม่`
          for (const r of batches[i]) allErrors.push({ row_number: r.rowNumber, reason, severity: 'blocking' })
          await fetch(`/api/imports/${importId}/record-failed-batch`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rows: batches[i], reason }),
          }).catch(() => {})
        }
        setProgress(Math.round(((i + 1) / batches.length) * 100))
      }

      setPhase('finishing')
      const finishRes = await fetch(`${endpointBase}/finish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ import_id: importId, orders_created: ordersCreated, orders_updated: ordersUpdated, orders_locked: ordersLocked, lines_upserted: linesUpserted }),
      })
      const finishBody = await finishRes.json()
      if (!finishRes.ok) throw new Error(finishBody.error)

      const blockingCount = allErrors.filter((e) => e.severity === 'blocking').length
      setResult({
        file_name: `${transferFile.name} + ${pickLinesFile.name}`,
        uploaded_at: new Date().toISOString(),
        total_rows: rows.length,
        success_rows: finishBody.success_rows ?? rows.length - blockingCount,
        status: finishBody.status,
        orders_created: ordersCreated,
        orders_updated: ordersUpdated,
        orders_locked: ordersLocked,
        lines_upserted: linesUpserted,
        error_count: allErrors.length,
        blocking_count: blockingCount,
        warning_count: allErrors.length - blockingCount,
        // "ต้องแก้ไข" first, then by row in the file.
        errors: [...allErrors].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'blocking' ? -1 : 1) || a.row_number - b.row_number),
      })
      setPhase('done')
      setTransferFile(null)
      setPickLinesFile(null)
      setInputKey((k) => k + 1)
      router.refresh()
    } catch (e) {
      setError((e as Error).message)
      setPhase('error')
    }
  }

  function resetResult() {
    setPhase('idle')
    setResult(null)
    setError(null)
  }

  const barLabel = phase === 'parsing' ? 'กำลังอ่านไฟล์…' : phase === 'importing' ? `กำลังนำเข้า… ${progress}%` : phase === 'finishing' ? 'กำลังสรุปผล…' : ''
  const barWidth = phase === 'importing' ? progress : phase === 'parsing' || phase === 'finishing' ? 100 : 0
  const indeterminate = phase === 'parsing' || phase === 'finishing'

  return (
    <div className="card">
      <div className="card-title">Import WMS orders</div>
      <div className="card-subtitle" style={{ marginBottom: 14 }}>
        นำเข้า order จาก WMS
      </div>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <FilePicker
          key={`transfer-${inputKey}`}
          label="1. Transfer List"
          sublabel="รายการ Transfer (หัวออเดอร์)"
          disabled={busy}
          onChange={(f) => {
            setTransferFile(f)
            resetResult()
          }}
        />
        <FilePicker
          key={`pick-${inputKey}`}
          label="2. Warehouse Pick Lines"
          sublabel="รายการหยิบสินค้า (บรรทัดออเดอร์)"
          disabled={busy}
          onChange={(f) => {
            setPickLinesFile(f)
            resetResult()
          }}
        />
        <button className="btn btn-primary btn-sm" disabled={!transferFile || !pickLinesFile || busy} onClick={handleUpload}>
          {busy ? 'Importing…' : 'Upload'}
        </button>
      </div>
      {!busy && (transferFile ? !pickLinesFile : !!pickLinesFile) && (
        <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>
          เลือกไฟล์ให้ครบทั้ง 2 ไฟล์ก่อนกด Upload
        </div>
      )}
      <div style={{ marginTop: 8, fontSize: 12, color: 'var(--color-text-secondary)' }}>{hint}</div>

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

      {result && phase === 'done' && <UploadResult result={result} />}
    </div>
  )
}

const ERROR_PAGE_SIZE = 20
const STATUS_TH: Record<string, string> = { completed: 'สำเร็จ', failed: 'ไม่สำเร็จ', completed_with_errors: 'สำเร็จบางส่วน' }

/** Result of the upload just done -- same columns as Recent imports, then what got in, what did
 * not and what to check. Lives only in this page view (gone on reload; Recent imports keeps it). */
function UploadResult({ result }: { result: ImportSummary }) {
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(result.errors.length / ERROR_PAGE_SIZE))
  const pageErrors = result.errors.slice((page - 1) * ERROR_PAGE_SIZE, page * ERROR_PAGE_SIZE)
  const badge = result.status === 'completed' ? 'success' : result.status === 'failed' ? 'danger' : 'warning'
  return (
    <div style={{ marginTop: 16, borderTop: '1px solid var(--color-border)', paddingTop: 14 }}>
      <div style={{ fontWeight: 700, marginBottom: 8 }}>ผลการ Upload</div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '30%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '13%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '10%' }} />
          <col style={{ width: '8%' }} />
          <col style={{ width: '9%' }} />
          <col style={{ width: '8%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>FILE</th>
            <th>UPLOADED</th>
            <th>STATUS</th>
            <th>
              NEW
              <br />
              ORDERS
            </th>
            <th>
              DUPLICATE
              <br />
              ORDERS
            </th>
            <th>ROWS</th>
            <th>SUCCESS</th>
            <th>ERRORS</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td style={{ overflowWrap: 'break-word' }}>{result.file_name}</td>
            <td>{formatDateTime(result.uploaded_at)}</td>
            <td>
              <span className={`badge badge-${badge}`}>{STATUS_TH[result.status] ?? result.status}</span>
            </td>
            <td style={{ fontWeight: 700 }}>{result.orders_created.toLocaleString()}</td>
            <td>{result.orders_updated > 0 ? <span className="badge badge-warning">{result.orders_updated.toLocaleString()}</span> : 0}</td>
            <td>{result.total_rows.toLocaleString()}</td>
            <td>{result.success_rows.toLocaleString()}</td>
            <td style={{ color: result.error_count ? 'var(--color-danger)' : undefined, fontWeight: result.error_count ? 700 : 400 }}>{result.error_count.toLocaleString()}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', marginTop: 10, fontSize: 13, fontWeight: 600 }}>
        <span style={{ color: '#16A34A' }}>✓ นำเข้าได้ {result.success_rows.toLocaleString()} แถว</span>
        <span style={{ color: result.blocking_count ? 'var(--color-danger)' : 'var(--color-text-secondary)' }}>✗ นำเข้าไม่ได้ {result.blocking_count.toLocaleString()} แถว</span>
        <span style={{ color: result.warning_count ? '#B45309' : 'var(--color-text-secondary)' }}>⚠ คำเตือน {result.warning_count.toLocaleString()} แถว</span>
      </div>

      {result.orders_updated > 0 && (
        <div style={{ marginTop: 8, fontSize: 12.5, color: '#B45309', background: '#FFFBEB', borderRadius: 8, padding: '8px 12px' }}>
          {result.orders_created === 0
            ? `ทุกออเดอร์ในไฟล์นี้ (${result.orders_updated.toLocaleString()} ออเดอร์) เคยนำเข้าแล้ว — ระบบไม่สร้างออเดอร์ใหม่ซ้ำ`
            : `${result.orders_updated.toLocaleString()} ออเดอร์มีอยู่ในระบบแล้ว (Warehouse + Order No + วันที่ออเดอร์ ตรงกัน) — ไม่สร้างใหม่ซ้ำ`}
          {result.orders_updated - result.orders_locked > 0 && ` · ${(result.orders_updated - result.orders_locked).toLocaleString()} ออเดอร์ที่ยังไม่มอบหมายงาน อัปเดตรายการสินค้าตามไฟล์ล่าสุด`}
          {result.orders_locked > 0 && ` · ${result.orders_locked.toLocaleString()} ออเดอร์มอบหมายงานแล้ว ไม่อัปเดต (ล็อกไว้)`}
        </div>
      )}

      {result.error_count > 0 && (
        <div style={{ marginTop: 10 }}>
          <div style={{ fontSize: 12.5, marginBottom: 8 }}>
            {result.blocking_count > 0 && <div style={{ color: 'var(--color-danger)', fontWeight: 600 }}>แถว "ต้องแก้ไข" ยังไม่ถูกนำเข้า — แก้ไขไฟล์แล้ว Upload ใหม่ (แถวอ้างอิงไฟล์ Warehouse Pick Lines)</div>}
            {result.warning_count > 0 && <div style={{ color: '#B45309' }}>แถว "คำเตือน" นำเข้าแล้ว แต่ควรตรวจสอบ (ไม่บังคับแก้)</div>}
          </div>
          <table className="table" style={{ margin: 0 }}>
            <thead>
              <tr>
                <th style={{ width: 70 }}>แถว</th>
                <th style={{ width: 100 }}>ประเภท</th>
                <th>รายละเอียด</th>
              </tr>
            </thead>
            <tbody>
              {pageErrors.map((e, i) => (
                <tr key={`${page}-${i}`}>
                  <td>{e.row_number}</td>
                  <td>
                    <span className={`badge badge-${e.severity === 'blocking' ? 'danger' : 'warning'}`}>{e.severity === 'blocking' ? 'ต้องแก้ไข' : 'คำเตือน'}</span>
                  </td>
                  <td style={{ fontSize: 12 }}>{e.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
        </div>
      )}
    </div>
  )
}

function FilePicker({ label, sublabel, disabled, onChange }: { label: string; sublabel: string; disabled: boolean; onChange: (file: File | null) => void }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5, fontWeight: 600 }}>
      <span>
        {label} <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>· {sublabel}</span>
      </span>
      <input type="file" accept=".xlsx,.xls" disabled={disabled} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
    </label>
  )
}
