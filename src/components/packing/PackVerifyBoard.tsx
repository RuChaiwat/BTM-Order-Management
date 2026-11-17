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

/**
 * Admin Pack Verify -- same layout and flow as Admin Verification on the Pick side:
 *   left   the queue (oldest packed first) + "Confirm All Completed" for orders packed in full;
 *   middle the selected order's lines -- tick a short line, pick the Short Pick reason, enter the
 *          qty actually packed, checking against WMS;
 *   right  the summary and Confirm Pack.
 * An order the packer finished with "Completed with Short" is never part of Confirm All -- it must
 * be opened and checked -- but Admin may still confirm it in full (the packer can be wrong). No reject.
 */
export function PackVerifyBoard({ queue }: { queue: PackVerifyQueueItem[] }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [selectedId, setSelectedId] = useState(queue[0]?.order_id ?? '')
  const [lines, setLines] = useState<Line[] | null>(null)
  const [reasons, setReasons] = useState<Reason[]>([])
  const [lineState, setLineState] = useState<Record<string, LineState>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showConfirmAll, setShowConfirmAll] = useState(false)
  const [confirmOne, setConfirmOne] = useState(false)
  const working = busy || isRefreshing

  const selected = queue.find((o) => o.order_id === selectedId) ?? queue[0]
  // Confirm All covers only orders the packer finished as Completed; a Short one must be opened first.
  const fullyPacked = queue.filter((o) => !o.isShort)

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
  // Packer said Short but Admin is confirming every line in full -- allowed, just made explicit.
  const overridingShort = !!selected?.isShort && shortLines.length === 0

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

  async function doConfirmAll() {
    setBusy(true)
    setError(null)
    try {
      const body = await post({ order_ids: fullyPacked.map((o) => o.order_id) })
      if (body.failed?.length) setError(`ยืนยันไม่ได้: ${body.failed.join(', ')}`)
      setShowConfirmAll(false)
      setBusy(false)
      startRefresh(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  const tile = (label: string, value: React.ReactNode, color?: string) => (
    <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px' }}>
      <span style={{ color: '#6B7280', fontSize: 11 }}>{label}</span>
      <div style={{ fontWeight: 700, fontSize: 15, color, overflowWrap: 'break-word' }}>{value}</div>
    </div>
  )

  return (
    <div style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '280px minmax(0, 1fr) 320px', gap: 16, alignItems: 'start' }}>
        {/* ---- left: queue */}
        <div className="card">
          <div className="card-title">Pack verify queue</div>
          <div className="card-subtitle" style={{ marginBottom: 10 }}>
            คิวรอยืนยันการแพ็ก
          </div>
          <button className="btn btn-success btn-sm btn-block" style={{ marginBottom: 10 }} disabled={fullyPacked.length === 0 || working} onClick={() => setShowConfirmAll(true)}>
            Confirm All Completed ({fullyPacked.length})
          </button>
          {error && !confirmOne && !showConfirmAll && <div style={{ marginBottom: 8, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 560, overflowY: 'auto' }}>
            {queue.map((o) => (
              <button
                key={o.order_id}
                onClick={() => {
                  setSelectedId(o.order_id)
                  setError(null)
                }}
                style={{
                  textAlign: 'left',
                  border: o.order_id === selected?.order_id ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: 'var(--color-surface)',
                  cursor: 'pointer',
                  fontFamily: 'inherit',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span className="link" style={{ fontWeight: 700, fontSize: 12.5 }}>
                    {o.order_no}
                  </span>
                  <span className={`badge badge-${o.isShort ? 'warning' : 'success'}`} style={{ fontSize: 10 }}>
                    {o.isShort ? 'ไม่ครบ' : 'ครบ'}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: '#6B7280' }}>
                  {o.packerName} · {o.stationCode ?? '—'} · รอ {o.waitMinutes.toLocaleString()} นาที
                </div>
                {o.hadIssue && (
                  <span className="badge badge-neutral" style={{ fontSize: 10, marginTop: 3 }}>
                    เคยแจ้งปัญหา
                  </span>
                )}
              </button>
            ))}
            {queue.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>ไม่มี order รอยืนยันการแพ็ก</span>}
          </div>
        </div>

        {/* ---- middle: lines */}
        <div className="card">
          {selected ? (
            <>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                <div>
                  <span className="card-title">{selected.order_no}</span>
                  <span className="card-subtitle" style={{ marginLeft: 8 }}>
                    {selected.store_code}
                  </span>
                </div>
                <span className={`badge badge-${selected.isShort ? 'warning' : 'success'}`} style={{ marginLeft: 'auto' }}>
                  {selected.isShort ? 'Packer แจ้ง Completed with Short' : 'Packer แจ้ง Completed'}
                </span>
              </div>
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: 28 }} />
                  <col style={{ width: '32%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '11%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '15%' }} />
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
                        <td>
                          <button onClick={() => toggleShort(l)} className={`checkbox-box${st.isShort ? ' checked' : ''}`} style={{ border: st.isShort ? 'none' : undefined, cursor: 'pointer', padding: 0 }} title="แพ็กขาด?">
                            {st.isShort ? '✓' : ''}
                          </button>
                        </td>
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
                            <span style={{ color: '#9CA3AF' }}>—</span>
                          )}
                        </td>
                        <td>{st.isShort ? <input className="control" type="number" min={0} max={l.qty - 1} value={st.packedQty} onChange={(e) => updateLine(l.line_id, { packedQty: e.target.value })} style={{ width: '100%' }} /> : l.qty}</td>
                      </tr>
                    )
                  })}
                  {lines?.length === 0 && (
                    <tr>
                      <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                        ไม่พบรายการสินค้าของ order นี้
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
              <div style={{ marginTop: 10, fontSize: 12, color: 'var(--color-text-secondary)' }}>ติ๊กรายการที่แพ็กขาด แล้วระบุเหตุผลและจำนวนที่แพ็กจริง · ตรวจสอบกับระบบ WMS</div>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-secondary)' }}>เลือก order จากคิวด้านซ้าย</span>
          )}
        </div>

        {/* ---- right: summary */}
        <div className="card">
          <div className="card-title">Pack Verify Summary</div>
          <div className="card-subtitle" style={{ marginBottom: 14 }}>
            สรุปผลตรวจสอบการแพ็ก
          </div>
          {selected ? (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 12.5, marginBottom: 14 }}>
                {tile('ต้องแพ็ก (ชิ้น)', totalExpected.toLocaleString())}
                {tile('แพ็กจริง (ชิ้น)', totalPacked.toLocaleString(), totalPacked < totalExpected ? '#F59E0B' : '#16A34A')}
                {tile('Packer', selected.packerName)}
                {tile('Station', selected.stationCode ?? '—')}
                {tile('เวลาแพ็ก', duration(selected.packSeconds))}
                {tile('รอยืนยัน', `${selected.waitMinutes.toLocaleString()} นาที`)}
              </div>
              <div style={{ marginBottom: 12 }}>
                <span className={`badge badge-${shortLines.length > 0 ? 'warning' : 'success'}`}>{shortLines.length > 0 ? `แพ็กขาด ${shortLines.length} รายการ` : 'แพ็กครบ 100%'}</span>
              </div>
              {overridingShort && (
                <div style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--color-warning-dark)', background: 'var(--color-warning-bg)', borderRadius: 8, padding: '8px 10px' }}>
                  พนักงานแจ้ง <b>Completed with Short</b> — ถ้าตรวจใน WMS แล้วครบ กดยืนยันเต็มจำนวนได้ ถ้าขาดจริง ให้ติ๊กรายการที่ขาดตรงกลาง
                </div>
              )}
              {lineErrors.length > 0 && <div style={{ marginBottom: 12, fontSize: 12.5, color: 'var(--color-danger)' }}>รายการที่ติ๊กขาด ต้องเลือกเหตุผล และจำนวนต้องน้อยกว่าจำนวนที่ต้องแพ็ก</div>}
              <button
                className="btn btn-success btn-block"
                disabled={working || !lines || lines.length === 0 || lineErrors.length > 0}
                onClick={() => {
                  setError(null)
                  setConfirmOne(true)
                }}
              >
                {working && <Spinner />}
                {working ? 'Working…' : 'Confirm Pack'}
              </button>
            </>
          ) : (
            <span style={{ color: 'var(--color-text-secondary)' }}>—</span>
          )}
        </div>
      </div>

      {confirmOne && selected && (
        <Modal title={`Confirm pack ${selected.order_no}?`} subtitle="ยืนยันว่าทำ Confirm Pack ในระบบ WMS ตรงกันแล้ว" onSubmit={doConfirmOne}>
          <div className="modal-body">
            {shortLines.length > 0 ? (
              <>
                บันทึกว่าแพ็กขาด <strong>{shortLines.length} รายการ</strong> รวม <strong>{(totalExpected - totalPacked).toLocaleString()} ชิ้น</strong> — ตรวจให้ตรงกับที่ Confirm ใน WMS · ย้อนกลับไม่ได้
              </>
            ) : overridingShort ? (
              <>
                พนักงานแจ้ง <strong>Completed with Short</strong> แต่จะบันทึกว่า <strong>แพ็กครบทุกรายการ</strong> — ยืนยันว่าตรวจใน WMS แล้วครบจริง · ย้อนกลับไม่ได้
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

      {showConfirmAll && (
        <Modal title={`Confirm all ${fullyPacked.length} completed orders?`} subtitle="ยืนยันเฉพาะ order ที่พนักงานปิดงาน Completed" onSubmit={doConfirmAll}>
          <div className="modal-body">
            order ทั้ง {fullyPacked.length} รายการที่พนักงานแพ็กครบ จะถูกบันทึกเป็น <strong>ยืนยันแพ็กแล้ว ครบทุกรายการ</strong> · order ที่แจ้ง Completed with Short ไม่รวมอยู่ด้วย ต้องเปิดตรวจทีละ order · ย้อนกลับไม่ได้
            {error && <div style={{ marginTop: 8, color: 'var(--color-danger)' }}>{error}</div>}
          </div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setShowConfirmAll(false)}>
              Cancel
            </button>
            <button type="submit" className="modal-footer-btn btn-success" style={{ minWidth: 170, border: 0 }} disabled={working} autoFocus>
              {working && <Spinner />}
              {working ? 'Confirming…' : `Confirm all ${fullyPacked.length}`}
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
