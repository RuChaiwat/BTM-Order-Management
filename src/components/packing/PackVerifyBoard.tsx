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
 * Admin Pack Verify -- same shape as Admin Verification on the Pick side: the queue of orders the
 * packers finished (oldest first) on the left, the selected order's lines on the right. The Pack
 * Supervisor confirms in WMS first, then here: one order (Confirm Pack) or every ticked order at
 * once (Confirm selected). No reject, by client decision.
 */
export function PackVerifyBoard({ queue }: { queue: PackVerifyQueueItem[] }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [selectedId, setSelectedId] = useState(queue[0]?.order_id ?? '')
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [lines, setLines] = useState<Line[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmIds, setConfirmIds] = useState<string[] | null>(null)
  const working = busy || isRefreshing

  const selected = queue.find((o) => o.order_id === selectedId) ?? queue[0]
  const visibleChecked = queue.filter((o) => checked.has(o.order_id)).map((o) => o.order_id)
  const allChecked = queue.length > 0 && visibleChecked.length === queue.length

  useEffect(() => {
    if (!selected) return
    let cancelled = false
    setLines(null)
    fetch(`/api/pack-verifications?order_id=${selected.order_id}`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((b) => !cancelled && setLines(b.lines ?? []))
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

  async function doConfirm() {
    if (!confirmIds) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/pack-verifications', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_ids: confirmIds }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      if (body.failed?.length) setError(`ยืนยันไม่ได้ (สถานะเปลี่ยนไปแล้ว): ${body.failed.join(', ')}`)
      setChecked(new Set())
      setConfirmIds(null)
      setBusy(false)
      startRefresh(() => router.refresh())
    } catch (e) {
      setBusy(false)
      setError((e as Error).message)
    }
  }

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.4fr) minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 10 }}>
          <div>
            <div className="card-title">Packed orders</div>
            <div className="card-subtitle">คิวรอยืนยันการแพ็ก · เรียงตามเวลาที่แพ็กเสร็จ (เก่าสุดก่อน)</div>
          </div>
          <button className="btn btn-success btn-sm" style={{ marginLeft: 'auto' }} disabled={visibleChecked.length === 0 || working} onClick={() => setConfirmIds(visibleChecked)}>
            Confirm selected ({visibleChecked.length})
          </button>
        </div>
        {error && <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--color-danger)' }}>{error}</div>}
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>
                <button
                  className={`checkbox-box${allChecked ? ' checked' : ''}`}
                  style={{ border: allChecked ? 'none' : undefined, cursor: 'pointer', padding: 0 }}
                  title="Select all"
                  onClick={() => setChecked(allChecked ? new Set() : new Set(queue.map((o) => o.order_id)))}
                >
                  {allChecked ? '✓' : ''}
                </button>
              </th>
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
                <td onClick={(e) => e.stopPropagation()}>
                  <button className={`checkbox-box${checked.has(o.order_id) ? ' checked' : ''}`} style={{ border: checked.has(o.order_id) ? 'none' : undefined, cursor: 'pointer', padding: 0 }} onClick={() => toggle(o.order_id)}>
                    {checked.has(o.order_id) ? '✓' : ''}
                  </button>
                </td>
                <td style={{ overflowWrap: 'break-word' }}>
                  <span className="link" style={{ fontWeight: 700 }}>
                    {o.order_no}
                  </span>
                  <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{o.store_code}</div>
                  {o.hadIssue && (
                    <span className="badge badge-warning" style={{ fontSize: 10 }}>
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
                <div className="card-title">{selected.order_no}</div>
                <div className="card-subtitle">
                  {selected.store_code} · แพ็กโดย {selected.packerName} · Station {selected.stationCode ?? '—'}
                </div>
              </div>
              <button className="btn btn-success btn-sm" style={{ marginLeft: 'auto' }} disabled={working} onClick={() => setConfirmIds([selected.order_id])}>
                Confirm Pack
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, margin: '12px 0', fontSize: 12.5 }}>
              <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>Pieces</span>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{selected.pieces.toLocaleString()}</div>
              </div>
              <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>Pack time</span>
                <div style={{ fontWeight: 700, fontSize: 16 }}>{duration(selected.packSeconds)}</div>
              </div>
              <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 10px' }}>
                <span style={{ color: 'var(--color-text-secondary)', fontSize: 11 }}>Packed at</span>
                <div style={{ fontWeight: 700, fontSize: 13 }}>{timeOf(selected.packedAt)}</div>
              </div>
            </div>
            <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
              <colgroup>
                <col style={{ width: '58%' }} />
                <col style={{ width: '24%' }} />
                <col style={{ width: '18%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>BIN</th>
                  <th>QTY</th>
                </tr>
              </thead>
              <tbody>
                {lines === null && (
                  <tr>
                    <td colSpan={3}>
                      <Spinner dark />
                    </td>
                  </tr>
                )}
                {lines?.map((l) => (
                  <tr key={l.line_id}>
                    <td style={{ overflowWrap: 'break-word' }}>
                      {l.sku}
                      {l.item_description && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{l.item_description}</div>}
                    </td>
                    <td>{formatLocationDisplay(l.bin_code)}</td>
                    <td style={{ fontWeight: 700 }}>{l.qty}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : (
          <span style={{ color: 'var(--color-text-secondary)' }}>เลือก order จากคิวด้านซ้าย</span>
        )}
      </div>

      {confirmIds && (
        <Modal title={confirmIds.length === 1 ? 'Confirm pack?' : `Confirm ${confirmIds.length} packed orders?`} subtitle="ยืนยันว่าทำ Confirm Pack ในระบบ WMS แล้ว" onSubmit={doConfirm}>
          <div className="modal-body">
            {confirmIds.length === 1 ? 'order นี้' : `order ทั้ง ${confirmIds.length} รายการ`} จะถูกบันทึกเป็น <strong>ยืนยันแพ็กแล้ว</strong> และออกจากคิว · ย้อนกลับไม่ได้
          </div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setConfirmIds(null)}>
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
