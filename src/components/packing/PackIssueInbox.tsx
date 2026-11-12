'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'
import { formatLocationDisplay } from '../../lib/locations/locationDisplay'
import { PACK_ROOT_CAUSES } from '../../lib/packing'
import type { PackIssueListItem } from '../../lib/queries/packing'

type Detail = {
  issue: {
    issue_id: string
    status: 'open' | 'investigating' | 'resolved'
    station_code: string | null
    stationName: string
    picker_id: string | null
    packerName: string
    remark: string | null
    reported_at: string
    acknowledgedByName: string | null
    acknowledged_at: string | null
    root_cause: string | null
    resolution: string | null
    resolution_note: string | null
    resolvedByName: string | null
    resolved_at: string | null
  }
  issueLines: { id: string; line_id: string | null; sku: string; item_description: string | null; bin_code: string | null; reason_code: string; reasonLabel: string; qty: number }[]
  order: { order_no: string; store_code: string; pack_status: string | null } | null
  pick: {
    pickerId: string | null
    pickerName: string | null
    assignedBy: string | null
    assignedTime: string | null
    zone: string | null
    completedTime: string | null
    result: string | null
    verifications: { adminName: string; decision: string; verified_time: string; reject_reason: string | null }[]
    lines: { line_id: string; sku: string; item_description: string | null; bin_code: string; zone_code: string | null; qty: number; picked_qty: number | null; short_reason_code: string | null; flagged: boolean }[]
  }
  packSessions: { session_id: string; pickerName: string; picker_id: string; station_code: string; started_at: string; finished_at: string | null; result: string | null; pieces: number; issue_pieces: number; cancel_reason: string | null; cancelledByName: string | null }[]
}

const STATUS_BADGE: Record<string, { cls: string; th: string }> = {
  open: { cls: 'badge-danger', th: 'ยังไม่มีคนรับ' },
  investigating: { cls: 'badge-warning', th: 'กำลังตรวจสอบ' },
  resolved: { cls: 'badge-success', th: 'ปิดแล้ว' },
}
const RESULT_TH: Record<string, string> = { completed: 'Completed', completed_short: 'Completed with Short', cancelled: 'ยกเลิก' }

function dt(iso: string | null) {
  return iso ? new Date(iso).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'
}
function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 60 ? `${m} นาทีที่แล้ว` : m < 1440 ? `${Math.floor(m / 60)} ชม.ที่แล้ว` : `${Math.floor(m / 1440)} วันที่แล้ว`
}

/**
 * Pack Issue Investigation -- an inbox: issue list on the left (unresolved first, newest first;
 * "ยังไม่มีคนรับ" = nobody has taken it yet), the selected issue on the right with what the packer
 * reported, the order's full Pick history (who picked it, from which bin/zone, who verified --
 * the reported SKU's line highlighted), every pack attempt, and the resolve form.
 */
export function PackIssueInbox({ issues, initialIssueId }: { issues: PackIssueListItem[]; initialIssueId?: string }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [filter, setFilter] = useState<'unresolved' | 'resolved' | 'all'>('unresolved')
  const [station, setStation] = useState('')
  const [selectedId, setSelectedId] = useState(initialIssueId && issues.some((i) => i.issue_id === initialIssueId) ? initialIssueId : '')
  const [detail, setDetail] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rootCause, setRootCause] = useState('')
  const [resolution, setResolution] = useState<'closed_by_admin' | 'returned_to_pack' | ''>('')
  const [note, setNote] = useState('')
  const [lineQty, setLineQty] = useState<Record<string, string>>({})

  // The pop-up's "ดูรายละเอียด" can navigate here again with a new ?issue= while this page is
  // already open -- follow it.
  useEffect(() => {
    if (initialIssueId) {
      setSelectedId(initialIssueId)
      setFilter('all')
      setStation('')
    }
  }, [initialIssueId])

  const stations = useMemo(() => [...new Set(issues.map((i) => i.station_code).filter(Boolean))].sort() as string[], [issues])
  const visible = issues.filter((i) => (filter === 'all' ? true : filter === 'resolved' ? i.status === 'resolved' : i.status !== 'resolved')).filter((i) => !station || i.station_code === station)
  const effectiveId = selectedId || visible[0]?.issue_id || ''

  const load = useCallback(async (id: string) => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/pack-issues/${id}`, { cache: 'no-store' })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setDetail(body)
      setRootCause(body.issue.root_cause ?? '')
      setResolution(body.issue.resolution ?? '')
      setNote(body.issue.resolution_note ?? '')
      setLineQty(Object.fromEntries((body.issueLines as Detail['issueLines']).map((l) => [l.id, String(l.qty)])))
    } catch (e) {
      setError((e as Error).message)
      setDetail(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (effectiveId) load(effectiveId)
    else setDetail(null)
  }, [effectiveId, load])

  async function act(payload: Record<string, unknown>) {
    if (!detail) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch(`/api/pack-issues/${detail.issue.issue_id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      await load(detail.issue.issue_id)
      startRefresh(() => router.refresh())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function resolve() {
    if (!detail) return
    if (!rootCause) return setError('เลือกสาเหตุจริง')
    if (!resolution) return setError('เลือกวิธีปิดเรื่อง')
    const changed: Record<string, number> = {}
    for (const l of detail.issueLines) {
      const q = Number(lineQty[l.id])
      if (!Number.isInteger(q) || q < 1) return setError(`จำนวนของ ${l.sku} ต้องเป็นจำนวนเต็มตั้งแต่ 1 ขึ้นไป`)
      if (q !== l.qty) changed[l.id] = q
    }
    act({ action: 'resolve', root_cause: rootCause, resolution, note, line_qty: changed })
  }

  const working = busy || isRefreshing
  const resolved = detail?.issue.status === 'resolved'

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: 16, alignItems: 'start' }}>
      <div className="card">
        <div style={{ display: 'flex', gap: 6, marginBottom: 10, flexWrap: 'wrap' }}>
          {(
            [
              ['unresolved', 'ยังไม่ปิด'],
              ['resolved', 'ปิดแล้ว (7 วัน)'],
              ['all', 'ทั้งหมด'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} className={`btn btn-sm ${filter === k ? 'btn-primary' : 'btn-secondary'}`} onClick={() => setFilter(k)}>
              {label}
            </button>
          ))}
        </div>
        <select className="field-input" style={{ border: '1px solid var(--color-border)', marginBottom: 10, width: '100%' }} value={station} onChange={(e) => setStation(e.target.value)}>
          <option value="">ทุก Station</option>
          {stations.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, maxHeight: 620, overflowY: 'auto' }}>
          {visible.map((i) => {
            const active = i.issue_id === effectiveId
            return (
              <button
                key={i.issue_id}
                onClick={() => setSelectedId(i.issue_id)}
                style={{
                  textAlign: 'left',
                  border: active ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
                  borderRadius: 8,
                  padding: '8px 10px',
                  background: i.status === 'open' ? 'var(--color-danger-bg)' : 'var(--color-surface)',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
                  <span style={{ fontWeight: i.status === 'open' ? 800 : 600, fontSize: 12.5 }}>
                    {i.station_code ?? '—'} · {i.reasons.join(', ') || '—'}
                  </span>
                  <span className={`badge ${STATUS_BADGE[i.status].cls}`} style={{ fontSize: 10, whiteSpace: 'nowrap' }}>
                    {STATUS_BADGE[i.status].th}
                  </span>
                </div>
                <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>
                  {i.order_no} · {i.pieces} ชิ้น · {i.packerName} · {ago(i.reported_at)}
                </div>
                {i.acknowledgedBy && i.status === 'investigating' && <div style={{ fontSize: 11, color: 'var(--color-warning-dark)' }}>รับเรื่องโดย {i.acknowledgedBy}</div>}
              </button>
            )
          })}
          {visible.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>ไม่มีรายการ</span>}
        </div>
      </div>

      <div className="card">
        {loading && !detail && <Spinner dark />}
        {!effectiveId && <span style={{ color: 'var(--color-text-secondary)' }}>ไม่มีปัญหาที่ต้องตรวจสอบ</span>}
        {error && <div style={{ marginBottom: 10, fontSize: 12.5, color: 'var(--color-danger)' }}>{error}</div>}
        {detail && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, opacity: loading ? 0.6 : 1 }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
              <div>
                <div className="card-title">
                  Order {detail.order?.order_no} <span className={`badge ${STATUS_BADGE[detail.issue.status].cls}`}>{STATUS_BADGE[detail.issue.status].th}</span>
                </div>
                <div className="card-subtitle">
                  {detail.order?.store_code} · Station {detail.issue.station_code} {detail.issue.stationName && `(${detail.issue.stationName})`} · แจ้งโดย {detail.issue.packerName} ({detail.issue.picker_id}) · {dt(detail.issue.reported_at)}
                </div>
                {detail.issue.acknowledgedByName && (
                  <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 2 }}>
                    รับเรื่องโดย {detail.issue.acknowledgedByName} · {dt(detail.issue.acknowledged_at)}
                  </div>
                )}
              </div>
              {detail.issue.status === 'open' && (
                <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} disabled={working} onClick={() => act({ action: 'acknowledge' })}>
                  {working && <Spinner />} รับเรื่อง
                </button>
              )}
            </div>

            <section>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>1. ปัญหาที่แจ้ง</div>
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '24%' }} />
                  <col style={{ width: '16%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>BIN</th>
                    <th>ปัญหา</th>
                    <th>จำนวน</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.issueLines.map((l) => (
                    <tr key={l.id}>
                      <td style={{ overflowWrap: 'break-word' }}>
                        {l.sku}
                        <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{l.line_id ? l.item_description : 'ไม่อยู่ใน TO'}</div>
                      </td>
                      <td>{l.bin_code ? formatLocationDisplay(l.bin_code) : '—'}</td>
                      <td>{l.reasonLabel}</td>
                      <td>
                        {resolved ? (
                          <b>{l.qty}</b>
                        ) : (
                          <input className="control" type="number" min={1} step={1} style={{ width: 70 }} value={lineQty[l.id] ?? ''} onChange={(e) => setLineQty((p) => ({ ...p, [l.id]: e.target.value }))} />
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {detail.issue.remark && <div style={{ fontSize: 12.5, marginTop: 6 }}>หมายเหตุจาก Packer: “{detail.issue.remark}”</div>}
            </section>

            <section>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>2. History งาน Pick</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 8, fontSize: 12.5, marginBottom: 8 }}>
                {[
                  ['Picker', detail.pick.pickerName ? `${detail.pick.pickerName} (${detail.pick.pickerId})` : '—'],
                  ['Zone ที่มอบหมาย', detail.pick.zone ?? '—'],
                  ['มอบหมาย', `${dt(detail.pick.assignedTime)}${detail.pick.assignedBy ? ` · ${detail.pick.assignedBy}` : ''}`],
                  ['Pick เสร็จ', `${dt(detail.pick.completedTime)}${detail.pick.result ? ` · ${detail.pick.result === '100_percent' ? '100%' : 'Short'}` : ''}`],
                ].map(([k, v]) => (
                  <div key={k} style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '8px 10px' }}>
                    <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{k}</div>
                    <div style={{ fontWeight: 600, overflowWrap: 'break-word' }}>{v}</div>
                  </div>
                ))}
              </div>
              {detail.pick.verifications.length > 0 && (
                <div style={{ fontSize: 12.5, marginBottom: 8 }}>
                  Admin Verification:{' '}
                  {detail.pick.verifications.map((v, i) => (
                    <span key={i}>
                      {i > 0 && ' → '}
                      {v.decision === 'final_close' ? 'Final Close' : `Reject (${v.reject_reason ?? ''})`} โดย {v.adminName} {dt(v.verified_time)}
                    </span>
                  ))}
                </div>
              )}
              <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
                <colgroup>
                  <col style={{ width: '40%' }} />
                  <col style={{ width: '20%' }} />
                  <col style={{ width: '12%' }} />
                  <col style={{ width: '14%' }} />
                  <col style={{ width: '14%' }} />
                </colgroup>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>LOCATION</th>
                    <th>ZONE</th>
                    <th>ORDERED</th>
                    <th>PICKED</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.pick.lines.map((l) => (
                    <tr key={l.line_id} className={l.flagged ? 'row-flag' : undefined} style={l.flagged ? { background: 'var(--color-warning-bg)' } : undefined}>
                      <td style={{ overflowWrap: 'break-word' }}>
                        {l.sku}
                        {l.item_description && <div style={{ fontSize: 11, color: 'var(--color-text-secondary)' }}>{l.item_description}</div>}
                      </td>
                      <td>{formatLocationDisplay(l.bin_code)}</td>
                      <td>{l.zone_code ?? '—'}</td>
                      <td>{l.qty}</td>
                      <td style={{ fontWeight: 700, color: l.picked_qty !== null && l.picked_qty < l.qty ? 'var(--color-warning-dark)' : undefined }}>
                        {l.picked_qty ?? '—'}
                        {l.short_reason_code && <div style={{ fontSize: 10.5, fontWeight: 400 }}>{l.short_reason_code}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>

            <section>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>3. History งาน Pack</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
                {detail.packSessions.map((s) => (
                  <div key={s.session_id}>
                    {dt(s.started_at)} → {dt(s.finished_at)} · {s.pickerName} ({s.picker_id}) · Station {s.station_code} · <b>{s.result ? RESULT_TH[s.result] ?? s.result : 'กำลังแพ็ก'}</b>
                    {s.result === 'cancelled' && ` โดย ${s.cancelledByName ?? '—'}: ${s.cancel_reason ?? ''}`}
                  </div>
                ))}
              </div>
            </section>

            <section style={{ borderTop: '1px dashed var(--color-border)', paddingTop: 12 }}>
              <div style={{ fontWeight: 700, marginBottom: 8 }}>4. ผลการตรวจสอบ</div>
              {resolved ? (
                <div style={{ fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div>สาเหตุจริง: <b>{PACK_ROOT_CAUSES.find((r) => r.code === detail.issue.root_cause)?.th ?? detail.issue.root_cause}</b></div>
                  <div>การปิดเรื่อง: <b>{detail.issue.resolution === 'closed_by_admin' ? 'Admin ปิดเอง → ส่งไป Admin Pack Verify' : 'ส่งกลับไปรอแพ็ก'}</b></div>
                  {detail.issue.resolution_note && <div>หมายเหตุ: {detail.issue.resolution_note}</div>}
                  <div style={{ color: 'var(--color-text-secondary)' }}>
                    ปิดโดย {detail.issue.resolvedByName} · {dt(detail.issue.resolved_at)}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <select className="field-input" style={{ border: '1px solid var(--color-border)' }} value={rootCause} onChange={(e) => setRootCause(e.target.value)}>
                    <option value="">— สาเหตุจริง —</option>
                    {PACK_ROOT_CAUSES.map((r) => (
                      <option key={r.code} value={r.code}>
                        {r.th}
                      </option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13 }}>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" checked={resolution === 'closed_by_admin'} onChange={() => setResolution('closed_by_admin')} />
                      Admin ปิดเอง → ส่งไป Admin Pack Verify
                    </label>
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', cursor: 'pointer' }}>
                      <input type="radio" checked={resolution === 'returned_to_pack'} onChange={() => setResolution('returned_to_pack')} />
                      ส่งกลับไปรอแพ็ก (ใครก็ได้ scan แพ็กใหม่)
                    </label>
                  </div>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="หมายเหตุผลการตรวจสอบ (ไม่บังคับ)"
                    style={{ width: '100%', minHeight: 60, border: '1px solid var(--color-border)', borderRadius: 8, padding: '8px 10px', fontSize: 13, fontFamily: 'inherit' }}
                  />
                  <button className="btn btn-success" style={{ alignSelf: 'flex-start', minWidth: 180 }} disabled={working} onClick={resolve}>
                    {working && <Spinner />} บันทึกผลและปิดเรื่อง
                  </button>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}
