'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'
import { formatLocationDisplay } from '../../lib/locations/locationDisplay'
import type { PackVerifyQueueItem } from '../../lib/queries/packVerification'

interface Line {
  line_id: string
  sku: string
  sku_barcode: string | null
  item_description: string | null
  bin_code: string
  qty: number
}
interface Reason {
  reason_code: string
  label_en: string
  label_th: string | null
}
interface LineState {
  isShort: boolean
  packedQty: string
  reasonCode: string
  remark: string
}

function duration(sec: number | null) {
  if (sec === null) return '—'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s).padStart(2, '0')}s`
}

function timeOf(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}

/**
 * Admin Pack Verify -- same shape as Admin Verification on the Pick side. Queue on the left (oldest
 * packed first); the selected order's lines on the right, where the Pack Supervisor ticks the
 * short lines and enters the actual packed qty + Short Pick reason while confirming in WMS. An
 * order the packer finished with "Completed with Short" must be confirmed this way, one at a time;
 * orders packed in full can also be ticked and confirmed together. No reject.
 */
export function PackVerifyBoard({ queue }: { queue: PackVerifyQueueItem[] }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [selectedId, setSelectedId] = useState(queue[0]?.order_id ?? '')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [lines, setLines] = useState<Line[] | null>(null)
  const [reasons, setReasons] = useState<Reason[]>([])
  const [lineState, setLineState] = useState<Record<string, LineState>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [bulkIds, setBulkIds] = useState<string[] | null>(null)
  const [confirmOne, setConfirmOne] = useState(false)
  const working = busy || isRefreshing

  const selected = queue.find((o) => o.order_id === selectedId) ?? queue[0]
  const bulkable = queue.filter((o) => !o.isShort)
  const visibleChecked = bulkable.filter((o) => checked.has(o.order_id)).map((o) => o.order_id)
  const allChecked = bulkable.length > 0 && visibleChecked.length === bulkable.length

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLines(null)
    fetch(`/api/pack-verifications?order_id=${selected.order_id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => {
        if (cancelled) return
        const ls: Line[] = b.lines ?? []
        setLines(ls)
        setReasons(b.reasons ?? [])
        setLineState(Object.fromEntries(ls.map((l) => [l.line_id, { isShort: false, packedQty: String(l.qty), reasonCode: '', remark: '' }])))
      })
      .catch(() => !cancelled && setLines([]))
    return () => {
      cancelled = true
    }
  }, [selected])

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  function toggleShort(l: Line) {
    setLineState((prev) => {
      const cur = prev[l.line_id]
      const isShort = !cur.isShort
      return { ...prev, [l.line_id]: { ...cur, isShort, packedQty: isShort ? '' : String(l.qty), reasonCode: isShort ? reasons[0]?.reason_code ?? '' : '' } }
    })
  }
  function updateLine(id: string, patch: Partial<LineState>) {
    setLineState((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }))
  }

  const shortLines = (lines ?? []).filter((l) => lineState[l.line_id]?.isShort)
  const lineErrors = shortLines.filter((l) => {
    const st = lineState[l.line_id]
    const q = Number(st.packedQty)
    return !st.reasonCode || st.packedQty === '' || !Number.isFinite(q) || q < 0 || q >= l.qty
  })
  const totalExpected = (lines ?? []).reduce((s, l) => s + l.qty, 0)
  const totalPacked = (lines ?? []).reduce((s, l) => {
    const st = lineState[l.line_id]
    return s + (st?.isShort ? Number(st.packedQty || 0) : l.qty)
  }, 0)
  const needsShortEntry = selected?.isShort && shortLines.length === 0

  async function post(payload: Record<string, unknown>) {
    const res = await apiFetch('/api/pack-verifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
    const body = await res.json()
    if (!res.ok) throw new Error(body.error)
    return body
  }

  async function doConfirmOne() {
    if (!selected || !lines) return
    setBusy(true)
    setError(null)
    try {
      await post({
        order_id: selected.order_id,
        lines: lines.map((l) => {
          const st = lineState[l.line_id]
          return st.isShort ? { line_id: l.line_id, packed_qty: Number(st.packedQty), short_reason_code: st.reasonCode, remark: st.remark } : { line_id: l.line_id, packed_qty: l.qty }
        }),
      })
      setConfirmOne(false)
      setBusy(false)
      startRefresh(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  async function doConfirmBulk() {
    if (!bulkIds) return
    setBusy(true)
    setError(null)
    try {
      const body = await post({ order_ids: bulkIds })
      if (body.failed?.length) setError(`ยืนยันไม่ได้: ${body.failed.join(', ')}`)
      setChecked(new Set())
      setBulkIds(null)
      setBusy(false)
      startRefresh(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  const checkbox = (on: boolean, onClick: () => void, disabled?: boolean, title?: string) => (
    <button className={`checkbox-box${on ? ' checked' : ''}`} style={{ border: on ? 'none' : undefined, cursor: disabled ? 'not-allowed' : 'pointer', padding: 0, opacity: disabled ? 0.35 : 1 }} onClick={onClick} disabled={disabled} title={title}>
      {on ? '✓' : ''}
    </button>
  )

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
          <div>
            <div className="card-title">Packed orders</div>
            <div className="card-subtitle">คิวรอยืนยันการแพ็ก · เรียงตามเวลาที่แพ็กเสร็จ · order แบบ Short ต้องเปิดยืนยันทีละ order</div>
          </div>
          <button className="btn btn-success btn-sm" style={{ marginLeft: 'auto' }} disabled={visibleChecked.length === 0 || working} onClick={() => setBulkIds(visibleChecked)}>
            Confirm selected ({visibleChecked.length})
          </button>
        </div>
        {error && !confirmOne && <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--color-danger)' }}>{error}</div>}
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: '24%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '13%' }} />
            <col style={{ width: '17%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>{checkbox(allChecked, () => setChecked(allChecked ? new Set() : new Set(bulkable.map((o) => o.order_id))), bulkable.length === 0, 'เลือกทุก order ที่แพ็กครบ')}</th>
              <th>ORDER</th>
              <th>PACKER</th>
              <th>STATION</th>
              <th>PCS</th>
              <th>
                PACK
                <br />
                TIME
              </th>
              <th>
                PACKED
                <br />
                AT
              </th>
            </tr>
          </thead>
          <tbody>
            {queue.map((o) => (
              <tr key={o.order_id} onClick={() => setSelectedId(o.order_id)} style={{ cursor: 'pointer', background: o.order_id === selected?.order_id ? 'var(--color-info-bg)' : undefined }}>
                <td onClick={(e) => e.stopPropagation()}>{checkbox(checked.has(o.order_id), () => toggle(o.order_id), o.isShort, o.isShort ? 'order แบบ Short ต้องเปิดยืนยันทีละ order' : undefined)}</td>
                <td style={{ overflowWrap: 'break-word' }}>
                  <span className="link" style={{ fontWeight: 700 }}>
                    {o.order_no}
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{o.store_code}</div>
                  {o.isShort && (
                    <span className="badge badge-warning" style={{ fontSize: 10 }}>
                      Short
                    </span>
                  )}
                  {o.hadIssue && (
                    <span className="badge badge-neutral" style={{ fontSize: 10 }}>
                      เคยแจ้งปัญหา
                    </span>
                  )}
                </td>
                <td style={{ overflowWrap: 'break-word' }}>
                  {o.packerName}
                  {o.packerId && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{o.packerId}</div>}
                </td>
                <td>{o.stationCode ?? '—'}</td>
                <td style={{ fontWeight: 700 }}>{o.pieces.toLocaleString()}</td>
                <td>{duration(o.packSeconds)}</td>
                <td style={{ fontSize: 12 }}>
                  {timeOf(o.packedAt)}
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>รอ {o.waitMinutes.toLocaleString()} นาที</div>
                </td>
              </tr>
            ))}
            {queue.length === 0 && (
              <tr>
                <td colSpan={7} style={{ color: 'var(--color-text-secondary)' }}>
                  ไม่มี order รอยืนยันการแพ็ก · Nothing waiting for pack confirmation.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div className="card-title">
                  {selected.order_no}{' '}
                  <span className={`badge ${selected.isShort ? 'badge-warning' : 'badge-success'}`}>{selected.isShort ? 'Completed with Short' : 'Completed'}</span>
                </div>
                <div className="card-subtitle">
                  {selected.store_code} · แพ็กโดย {selected.packerName} · Station {selected.stationCode ?? '—'} · {duration(selected.packSeconds)}
                </div>
              </div>
            </div>
            <div className="card-subtitle" style={{ margin: '10px 0' }}>
              ติ๊กรายการที่แพ็กขาด แล้วระบุเหตุผลและจำนวนที่แพ็กจริง · ตรวจสอบกับระบบ WMS ก่อนกดยืนยัน
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: 28 }} />
                <col style={{ width: '34%' }} />
                <col style={{ width: '16%' }} />
                <col style={{ width: '12%' }} />
                <col style={{ width: '22%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th />
                  <th>BARCODE</th>
                  <th>BIN</th>
                  <th>QTY</th>
                  <th>REASON</th>
                  <th>
                    PACKED
                    <br />
                    QTY
                  </th>
                </tr>
              </thead>
              <tbody>
                {lines === null && (
                  <tr>
                    <td colSpan={6}>
                      <Spinner dark />
                    </td>
                  </tr>
                )}
                {lines?.map((l) => {
                  const st = lineState[l.line_id]
                  if (!st) return null
                  return (
                    <tr key={l.line_id} className={st.isShort ? 'row-flag' : undefined}>
                      <td>{checkbox(st.isShort, () => toggleShort(l), false, 'แพ็กขาด?')}</td>
                      <td style={{ overflowWrap: 'break-word' }}>
                        {l.sku_barcode || `SKU ${l.sku}`}
                        {l.item_description && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{l.item_description}</div>}
                      </td>
                      <td>{formatLocationDisplay(l.bin_code)}</td>
                      <td style={{ fontWeight: 700 }}>{l.qty}</td>
                      <td>
                        {st.isShort ? (
                          <select className="control" value={st.reasonCode} onChange={(e) => updateLine(l.line_id, { reasonCode: e.target.value })} style={{ width: '100%' }}>
                            <option value="">— เลือก —</option>
                            {reasons.map((r) => (
                              <option key={r.reason_code} value={r.reason_code}>
                                {r.label_th || r.label_en}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span style={{ color: 'var(--color-text-muted)' }}>—</span>
                        )}
                      </td>
                      <td>
                        {st.isShort ? (
                          <input className="control" type="number" min={0} max={l.qty - 1} value={st.packedQty} onChange={(e) => updateLine(l.line_id, { packedQty: e.target.value })} style={{ width: '100%' }} />
                        ) : (
                          l.qty
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            <div style={{ display: 'flex', gap: 14, alignItems: 'center', marginTop: 12, flexWrap: 'wrap', fontSize: 13 }}>
              <span>
                ชิ้นที่ต้องแพ็ก <b>{totalExpected.toLocaleString()}</b>
              </span>
              <span>
                แพ็กจริง <b style={{ color: totalPacked < totalExpected ? 'var(--color-warning-dark)' : 'var(--color-success-dark)' }}>{totalPacked.toLocaleString()}</b>
              </span>
              <button
                className="btn btn-success"
                style={{ marginLeft: 'auto', minWidth: 150 }}
                disabled={working || !lines || lineErrors.length > 0 || needsShortEntry}
                onClick={() => {
                  setError(null)
                  setConfirmOne(true)
                }}
              >
                Confirm Pack
              </button>
            </div>
            {needsShortEntry && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-warning-dark)' }}>พนักงานแจ้ง Completed with Short — ติ๊กรายการที่ขาดอย่างน้อย 1 รายการ พร้อมเหตุผลและจำนวน</div>}
            {lineErrors.length > 0 && <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--color-danger)' }}>รายการที่ติ๊กขาด ต้องเลือกเหตุผล และจำนวนต้องน้อยกว่าจำนวนที่ต้องแพ็ก</div>}
          </>
        ) : (
          <span style={{ color: 'var(--color-text-secondary)' }}>เลือก order จากคิวด้านซ้าย</span>
        )}
      </div>

      {confirmOne && selected && (
        <Modal title={`Confirm pack ${selected.order_no}?`} subtitle="ยืนยันว่าทำ Confirm Pack ในระบบ WMS ตรงกันแล้ว" onSubmit={doConfirmOne}>
          <div className="modal-body">
            {shortLines.length > 0 ? (
              <>
                บันทึกว่าแพ็กขาด <strong>{shortLines.length} รายการ</strong> รวม <strong>{(totalExpected - totalPacked).toLocaleString()} ชิ้น</strong> — ตรวจให้ตรงกับที่ Confirm ใน WMS · ย้อนกลับไม่ได้
              </>
            ) : (
              'แพ็กครบทุกรายการ · ย้อนกลับไม่ได้'
            )}
            {error && <div style={{ marginTop: 8, color: 'var(--color-danger)' }}>{error}</div>}
          </div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setConfirmOne(false)}>
              Cancel
            </button>
            <button type="submit" className="modal-footer-btn btn-success" style={{ minWidth: 150, border: 0 }} disabled={working} autoFocus>
              {working && <Spinner />}
              {working ? 'Confirming…' : 'Confirm'}
            </button>
          </ModalFooter>
        </Modal>
      )}

      {bulkIds && (
        <Modal title={`Confirm ${bulkIds.length} packed orders?`} subtitle="ยืนยันเฉพาะ order ที่แพ็กครบ (Completed)" onSubmit={doConfirmBulk}>
          <div className="modal-body">order ทั้ง {bulkIds.length} รายการ จะถูกบันทึกเป็น <strong>ยืนยันแพ็กแล้ว ครบทุกรายการ</strong> · ย้อนกลับไม่ได้</div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setBulkIds(null)}>
              Cancel
            </button>
            <button type="submit" className="modal-footer-btn btn-success" style={{ minWidth: 150, border: 0 }} disabled={working} autoFocus>
              {working && <Spinner />}
              {working ? 'Confirming…' : 'Confirm'}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
