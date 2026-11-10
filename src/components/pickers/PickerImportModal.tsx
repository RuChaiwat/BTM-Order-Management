'use client'

import { useState } from 'react'
import { Modal, ModalFooter } from '../Modal'
import { parseSpreadsheet, col } from '@/lib/importers/parseSpreadsheet'
import { PICKER_TEMPLATE_COLUMNS as C, type PickerImportError, type PickerImportRow } from '@/lib/pickerImport'

/** Upload window for the standard Picker template. Parses the file's FIRST sheet ("Pickers" in the
 * template) in the browser and sends the rows to /api/pickers/import, which validates every row
 * and writes all-or-nothing -- so on any error this lists the rows to fix and nothing has changed. */
export function PickerImportModal({ warehouseCode, onClose, onImported }: { warehouseCode: string; onClose: () => void; onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rowErrors, setRowErrors] = useState<PickerImportError[]>([])
  const [result, setResult] = useState<{ created: number; updated: number } | null>(null)

  async function upload() {
    if (!file) return
    setBusy(true)
    setError(null)
    setRowErrors([])
    setResult(null)
    try {
      const sheetRows = await parseSpreadsheet(file)
      const headers = Object.keys(sheetRows[0] ?? {})
      const hasId = sheetRows.length === 0 || col(Object.fromEntries(headers.map((h) => [h, 'x'])), C.pickerId) !== ''
      if (!hasId) throw new Error(`The first sheet has no "${C.pickerId}" column — use the template from "Download template" · ไฟล์ไม่ตรงกับ Template`)
      const rows: PickerImportRow[] = sheetRows.map((r, i) => ({
        rowNumber: i + 2,
        picker_id: col(r, C.pickerId),
        name_th: col(r, C.nameTh),
        name_en: col(r, C.nameEn),
        employment_type: col(r, C.employmentType),
        note: col(r, C.note),
      }))
      const res = await fetch('/api/pickers/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, warehouse_code: warehouseCode, file_name: file.name }),
      })
      const body = await res.json()
      if (!res.ok) {
        setError(body.error)
        setRowErrors(body.errors ?? [])
        return
      }
      setResult(body)
      onImported()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal title="Upload pickers from Excel" subtitle="นำเข้ารายชื่อพนักงานหยิบสินค้าจากไฟล์ Excel" onSubmit={upload}>
      <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 12, fontSize: 13 }}>
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>
          ใช้ไฟล์จากปุ่ม <b>Download template</b> · Picker ID ที่มีอยู่แล้ว = แก้ไขข้อมูล, Picker ID ใหม่ = เพิ่มพนักงาน (Active) · ถ้ามีแถวใดผิด ระบบจะไม่นำเข้าทั้งไฟล์
        </div>
        <input
          type="file"
          accept=".xlsx,.xls"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setError(null)
            setRowErrors([])
            setResult(null)
          }}
        />

        {result && (
          <div style={{ fontWeight: 600, color: '#16A34A', background: '#F0FDF4', borderRadius: 8, padding: '10px 12px' }}>
            ✓ นำเข้าสำเร็จ: เพิ่มใหม่ {result.created.toLocaleString()} คน · แก้ไข {result.updated.toLocaleString()} คน
          </div>
        )}
        {error && <div style={{ color: 'var(--color-danger)', background: 'var(--color-danger-bg)', borderRadius: 8, padding: '10px 12px' }}>{error}</div>}
        {rowErrors.length > 0 && (
          <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
            <table className="table" style={{ margin: 0, tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: 70 }} />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th>แถว</th>
                  <th>ต้องแก้ไข</th>
                </tr>
              </thead>
              <tbody>
                {rowErrors.map((e) => (
                  <tr key={e.rowNumber}>
                    <td>{e.rowNumber}</td>
                    <td style={{ fontSize: 12, overflowWrap: 'break-word' }}>{e.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <ModalFooter>
        <button type="button" className="modal-footer-btn btn-secondary" onClick={onClose} disabled={busy}>
          {result ? 'Close' : 'Cancel'}
        </button>
        {!result && (
          <button type="submit" className="modal-footer-btn btn-primary" style={{ minWidth: 140, border: 0 }} disabled={!file || busy}>
            {busy ? 'Uploading…' : 'Upload'}
          </button>
        )}
      </ModalFooter>
    </Modal>
  )
}
