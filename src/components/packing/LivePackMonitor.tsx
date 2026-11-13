'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Spinner } from '../Spinner'
import { apiFetch } from '../../lib/apiFetch'
import { RISK_COLOR } from '../../lib/alertColors'
import { packTimeBand, type PackTimeBand, type PackTimeBands } from '../../lib/packTimeBand'
import type { LiveSession } from '../../lib/queries/packing'

const PER_ROW = 10
const IDLE_COLOR = '#9CA3AF'

function elapsed(fromIso: string, now: number) {
  const s = Math.max(0, Math.floor((now - new Date(fromIso).getTime()) / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` : `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

type Filter = 'all' | PackTimeBand | 'idle' | 'issue'

/** Corner mark on a station that still has a reported problem not closed. */
function IssueMark() {
  return (
    <span
      title="มีการแจ้งปัญหาที่ยังไม่ปิด · Open pack issue"
      style={{ position: 'absolute', top: 10, right: 4, width: 20, height: 20, borderRadius: '50%', background: '#DC2626', color: '#fff', fontSize: 12, fontWeight: 700, lineHeight: '20px', textAlign: 'center', boxShadow: '0 0 0 2px #fff' }}
    >
      !
    </span>
  )
}

/**
 * Live Packing Monitor as one floor map: every active Pack Station in station order, 10 per row,
 * so a station keeps its place whatever its state. A packing station shows a header coloured by
 * how long its order has been open (Configuration > Packing: green / yellow / red), the station,
 * the packer's Thai name, the running time and the order no.; an idle station is a plain grey tile.
 * The colour of a tile's header strip alone says the band (the chips on top are the legend); a red
 * "!" in the corner marks a station with a reported problem not closed yet (Pack Issue
 * Investigation), gone once all its issues are closed.
 * The chips on top count each state and dim the rest of the map when clicked. Cancelling is behind
 * a click on the tile (details + reason), so it can't be hit by accident; Warehouse Manager sees the
 * map read-only. Sessions left open from a previous day are cancelled by the system (midnight cron,
 * and again whenever this page loads).
 */
export function LivePackMonitor({ live, idleStations, bands, issueStations, canCancel }: { live: LiveSession[]; idleStations: { station_code: string; name: string }[]; bands: PackTimeBands; issueStations: string[]; canCancel: boolean }) {
  const router = useRouter()
  const [isRefreshing, startRefresh] = useTransition()
  const [now, setNow] = useState(Date.now())
  const [filter, setFilter] = useState<Filter>('all')
  const [selected, setSelected] = useState<LiveSession | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  const bandOf = (s: LiveSession): PackTimeBand => packTimeBand((now - new Date(s.started_at).getTime()) / 60000, bands)

  // Every station on the floor, natural order (PK2 before PK10); a station with an open session
  // that is no longer in the active list still shows so the session can be seen and cancelled.
  const tiles = useMemo(() => {
    const byStation = new Map<string, LiveSession>()
    for (const s of live) {
      const cur = byStation.get(s.station_code)
      if (!cur || s.started_at < cur.started_at) byStation.set(s.station_code, s)
    }
    const codes = new Set([...idleStations.map((s) => s.station_code), ...byStation.keys(), ...issueStations])
    return [...codes].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).map((code) => ({ code, session: byStation.get(code) ?? null }))
  }, [live, idleStations, issueStations])
  const hasIssue = useMemo(() => new Set(issueStations), [issueStations])

  const counts = { green: 0, yellow: 0, red: 0, idle: 0 }
  for (const t of tiles) {
    if (t.session) counts[bandOf(t.session)]++
    else counts.idle++
  }

  async function doCancel() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const res = await apiFetch('/api/pack-sessions/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: selected.session_id, reason }) })
      const body = await res.json()
      if (!res.ok) throw new Error(body.error)
      setSelected(null)
      setReason('')
      startRefresh(() => router.refresh())
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const Y = bands.yellowMinutes
  const R = bands.redMinutes
  const chips: { key: Filter; color?: string; text: string; n: number }[] = [
    { key: 'all', text: 'ทั้งหมด', n: tiles.length },
    { key: 'green', color: RISK_COLOR.green, text: `< ${Y} นาที`, n: counts.green },
    { key: 'yellow', color: RISK_COLOR.yellow, text: `${Y}–${R - 1} นาที`, n: counts.yellow },
    { key: 'red', color: RISK_COLOR.red, text: `≥ ${R} นาที`, n: counts.red },
    { key: 'idle', color: IDLE_COLOR, text: 'ว่าง', n: counts.idle },
    { key: 'issue', text: 'มีปัญหายังไม่ปิด', n: tiles.filter((t) => hasIssue.has(t.code)).length },
  ]

  return (
    <div className="page-body" style={{ padding: '18px 24px', gap: 14 }}>
      <div className="card">
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
          <span className="card-title">Pack stations</span>
          <span className="card-subtitle">
            กำลังแพ็ก {(tiles.length - counts.idle).toLocaleString()} (Station) · ว่าง {counts.idle.toLocaleString()} (Station) · เรียงตามรหัส Station แถวละ {PER_ROW}
            {canCancel ? ' · กดที่กล่องเพื่อดูรายละเอียด / ยกเลิกงาน' : ''}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '10px 0 12px' }}>
          {chips.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setFilter(c.key)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12.5,
                padding: '5px 12px',
                borderRadius: 999,
                cursor: 'pointer',
                fontFamily: 'inherit',
                border: `1px solid ${filter === c.key ? 'var(--color-text)' : 'var(--color-border)'}`,
                background: filter === c.key ? 'var(--color-bg-subtle, #F3F4F6)' : 'transparent',
                fontWeight: filter === c.key ? 700 : 500,
              }}
            >
              {c.color && <span style={{ width: 9, height: 9, borderRadius: '50%', background: c.color }} />}
              {c.key === 'issue' && <span style={{ width: 15, height: 15, borderRadius: '50%', background: '#DC2626', color: '#fff', fontSize: 10, fontWeight: 700, lineHeight: '15px', textAlign: 'center' }}>!</span>}
              {c.text} <b>{c.n.toLocaleString()}</b> (Station)
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${PER_ROW}, minmax(0, 1fr))`, gap: 6 }}>
          {tiles.map(({ code, session: s }) => {
            const band = s ? bandOf(s) : null
            const flagged = hasIssue.has(code)
            const dim = filter !== 'all' && (filter === 'issue' ? !flagged : filter === 'idle' ? !!s : band !== filter)
            if (!s) {
              return (
                <div
                  key={code}
                  style={{ position: 'relative', opacity: dim ? 0.25 : 1, minHeight: 92, borderRadius: 8, border: '1px dashed #D1D5DB', background: '#F3F4F6', color: '#6B7280', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: 12 }}
                >
                  {flagged && <IssueMark />}
                  <div style={{ fontWeight: 700, fontSize: 13.5 }}>{code}</div>
                  <div>ว่าง</div>
                </div>
              )
            }
            const color = RISK_COLOR[band!]
            return (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setError(null)
                  setReason('')
                  setSelected(s)
                }}
                title={`${s.pickerName} · ${s.order_no}`}
                style={{ position: 'relative', opacity: dim ? 0.25 : 1, minHeight: 92, borderRadius: 8, border: '1px solid var(--color-border)', background: 'var(--color-surface, #fff)', padding: 0, overflow: 'hidden', cursor: 'pointer', textAlign: 'center', fontFamily: 'inherit', color: 'inherit' }}
              >
                <div style={{ background: color, height: 8 }} />
                {flagged && <IssueMark />}
                <div style={{ fontWeight: 700, fontSize: 13.5, marginTop: 3 }}>{code}</div>
                <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px' }}>{s.pickerName}</div>
                <div style={{ fontSize: 14, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: band === 'green' ? undefined : color }}>{elapsed(s.started_at, now)}</div>
                <div style={{ fontSize: 10.5, color: 'var(--color-text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', padding: '0 4px 4px' }}>{s.order_no}</div>
              </button>
            )
          })}
          {tiles.length === 0 && <div style={{ gridColumn: '1 / -1', color: 'var(--color-text-secondary)', fontSize: 13 }}>ยังไม่มี Pack Station ที่ Active · ตั้งค่าได้ที่ Pack Settings</div>}
        </div>
      </div>

      {selected && (
        <Modal title={`Station ${selected.station_code} · ${selected.order_no}`} subtitle="รายละเอียดงานที่กำลังแพ็ก" onSubmit={doCancel}>
          <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '120px 1fr', rowGap: 6, fontSize: 13.5 }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>Packer</span>
            <span>
              <b>{selected.pickerName}</b> ({selected.picker_id})
            </span>
            <span style={{ color: 'var(--color-text-secondary)' }}>Order</span>
            <span>
              <b>{selected.order_no}</b> · {selected.pieces.toLocaleString()} ชิ้น
            </span>
            <span style={{ color: 'var(--color-text-secondary)' }}>เริ่มแพ็ก</span>
            <span>{new Date(selected.started_at).toLocaleString('th-TH', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
            <span style={{ color: 'var(--color-text-secondary)' }}>เวลาที่ใช้</span>
            <span style={{ fontWeight: 700, color: bandOf(selected) === 'green' ? undefined : RISK_COLOR[bandOf(selected)] }}>{elapsed(selected.started_at, now)}</span>
          </div>
          {canCancel && (
            <div style={{ padding: '12px 24px 0' }}>
              <div style={{ fontSize: 12.5, marginBottom: 8, color: 'var(--color-text-secondary)' }}>ยกเลิกงาน: ไม่นับเป็น Productivity และ order จะกลับไปที่สถานะ รอแพ็ก</div>
              <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 6 }}>
                เหตุผล <span style={{ color: '#DC2626' }}>*</span>
              </div>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="เช่น scan order ผิด / พนักงานออกกะโดยไม่ปิดงาน"
                style={{ width: '100%', minHeight: 64, border: '1px solid var(--color-border)', borderRadius: 8, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit' }}
              />
              {error && <div style={{ marginTop: 6, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
            </div>
          )}
          <ModalFooter>
            <button type="button" className="modal-footer-btn btn-secondary" onClick={() => setSelected(null)}>
              Close
            </button>
            {canCancel && (
              <button type="submit" className="modal-footer-btn btn-danger" style={{ minWidth: 150, border: 0 }} disabled={!reason.trim() || busy || isRefreshing}>
                {busy && <Spinner />}
                ยกเลิกงาน
              </button>
            )}
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
