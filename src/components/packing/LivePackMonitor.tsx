'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'
import type { LiveSession } from '../../lib/queries/packing'

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** Who is packing what right now, at which station, for how long. Red = open longer than
 * Configuration > Packing > "Packing taking too long after"; amber = started on a previous day
 * (should be checked and cancelled at end of day). Cancel is for the Pack Supervisor only --
 * Warehouse Manager sees this screen read-only. */
export function LivePackMonitor({ live, idleStations, longMinutes, canCancel }: { live: LiveSession[]; idleStations: { station_code: string; name: string }[]; longMinutes: number; canCancel: boolean }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [now, setNow] = useState(Date.now())
  const [cancelling, setCancelling] = useState<LiveSession | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const isLong = (s: LiveSession) => now - new Date(s.started_at).getTime() > longMinutes * 60_000
  const longCount = live.filter(isLong).length
  const carriedCount = live.filter((s) => s.carriedOver).length

  async function doCancel() {
    if (!cancelling) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/pack-sessions/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: cancelling.session_id, reason }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setCancelling(null)
      setReason('')
      startRefresh(() => router.refresh())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const kpi = (label: string, th: string, value: number, color?: string) => (
    <div className="kpi-card" style={{ padding: 14 }}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-label-th">{th}</div>
      <div className="kpi-value compact" style={color ? { color } : undefined}>
        {value.toLocaleString()}
      </div>
    </div>
  )

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
      <div className="kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {kpi('PACKING NOW', 'กำลังแพ็ก', live.length)}
        {kpi('TOO LONG', `เกิน ${longMinutes} นาที`, longCount, longCount ? 'var(--color-danger)' : undefined)}
        {kpi('CARRIED OVER', 'ค้างจากวันก่อน', carriedCount, carriedCount ? 'var(--color-warning-dark)' : undefined)}
        {kpi('IDLE STATIONS', 'Station ว่าง', idleStations.length)}
      </div>

      <div className="card">
        <div className="card-title">Active packing</div>
        <div className="card-subtitle" style={{ marginBottom: 10 }}>
          งานที่ scan เริ่มแล้วยังไม่ปิด · สีแดง = นานเกินกำหนด · สีส้ม = ค้างข้ามวัน ต้องตรวจสอบและยกเลิก
        </div>
        {error && <div style={{ marginBottom: 8, fontSize: 12.5, color: 'var(--color-danger)' }}>{error}</div>}
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '16%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '8%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '16%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>STATION</th>
              <th>PACKER</th>
              <th>ORDER</th>
              <th>PCS</th>
              <th>ELAPSED</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {live.map((s) => {
              const long = isLong(s)
              const bg = s.carriedOver ? 'var(--color-warning-bg)' : long ? 'var(--color-danger-bg)' : undefined
              const fg = s.carriedOver ? 'var(--color-warning-dark)' : long ? 'var(--color-danger-dark)' : undefined
              return (
                <tr key={s.session_id} style={{ background: bg, color: fg }}>
                  <td style={{ fontWeight: 700 }}>
                    {s.station_code}
                    {s.stationName && <div style={{ fontSize: 11, fontWeight: 400 }}>{s.stationName}</div>}
                  </td>
                  <td style={{ overflowWrap: 'break-word' }}>
                    {s.pickerName}
                    <div style={{ fontSize: 11 }}>{s.picker_id}</div>
                  </td>
                  <td style={{ fontWeight: 700 }}>{s.order_no}</td>
                  <td>{s.pieces.toLocaleString()}</td>
                  <td style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                    {elapsed(s.started_at, now)}
                    {s.carriedOver && <div style={{ fontSize: 11, fontWeight: 400 }}>เริ่ม {new Date(s.started_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>}
                  </td>
                  <td>
                    {canCancel && (
                      <button className="btn btn-danger-outline btn-sm" disabled={busy || isRefreshing} onClick={() => setCancelling(s)}>
                        ยกเลิกงาน
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
            {live.length === 0 && (
              <tr>
                <td colSpan={6} style={{ color: 'var(--color-text-secondary)' }}>
                  ตอนนี้ไม่มีใครกำลังแพ็ก · Nobody is packing right now.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="card-title">Idle stations</div>
        <div className="card-subtitle" style={{ marginBottom: 10 }}>
          Station ที่ Active แต่ไม่มีงานเปิดอยู่
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {idleStations.map((s) => (
            <span key={s.station_code} className="badge badge-neutral" style={{ fontSize: 12, padding: '4px 10px' }}>
              {s.station_code} · {s.name}
            </span>
          ))}
          {idleStations.length === 0 && <span style={{ color: 'var(--color-text-secondary)', fontSize: 12.5 }}>—</span>}
        </div>
      </div>

      {cancelling && (
        <Modal title={`Cancel packing ${cancelling.order_no}?`} subtitle="ยกเลิกงานที่เปิดค้าง · order กลับไปรอแพ็ก" onSubmit={doCancel}>
          <div className="modal-body">
            งานของ <strong>{cancelling.pickerName}</strong> ที่ Station <strong>{cancelling.station_code}</strong> จะถูกยกเลิก ไม่นับเป็น Productivity และ order จะกลับไปที่สถานะ <strong>รอแพ็ก</strong>
          </div>
          <div style={{ padding: '12px 24px 0' }}>
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
              เหตุผล <span style={{ color: '#DC2626' }}>*</span>
            </div>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="เช่น scan order ผิด / พนักงานออกกะโดยไม่ปิดงาน"
              style={{ width: '100%', minHeight: 70, border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit' }}
              autoFocus
            />
            {error && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
          </div>
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setCancelling(null)}>
              Close
            </button>
            <button type="submit" className="modal-footer-btn btn-danger" style={{ minWidth: 150, border: 0 }} disabled={!reason.trim() || busy}>
              {busy && <Spinner />}
              ยกเลิกงาน
            </button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
