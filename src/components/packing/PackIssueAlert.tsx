'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

interface AlertIssue {
  issue_id: string
  order_no: string
  station_code: string | null
  packer: string
  reasons: string[]
  pieces: number
  reported_at: string
}

const POLL_MS = 15_000

function chime() {
  try {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    const ctx = new Ctx()
    ;[880, 660, 880].forEach((f, i) => {
      const o = ctx.createOscillator()
      const g = ctx.createGain()
      g.gain.value = 0.15
      o.frequency.value = f
      o.connect(g)
      g.connect(ctx.destination)
      o.start(ctx.currentTime + i * 0.18)
      o.stop(ctx.currentTime + i * 0.18 + 0.15)
    })
  } catch {
    /* audio blocked until the user has interacted with the page */
  }
}

function ago(iso: string) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000))
  return m < 1 ? 'เมื่อสักครู่' : m < 60 ? `${m} นาทีที่แล้ว` : `${Math.floor(m / 60)} ชม.ที่แล้ว`
}

/**
 * Pop-up for the Pack Supervisor on EVERY page (mounted in the (app) layout for roles that can open
 * Pack Issue Investigation): polls for issues nobody has taken yet and shows them bottom-right
 * with a chime for each new one, plus a Windows notification when the browser is in the
 * background (if allowed). It stays until someone presses "รับเรื่อง" -- then it disappears for
 * every other supervisor on their next poll too.
 */
export function PackIssueAlert() {
  const router = useRouter()
  const [issues, setIssues] = useState<AlertIssue[]>([])
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [minimized, setMinimized] = useState(false)
  const seen = useRef<Set<string> | null>(null)

  const poll = useCallback(async () => {
    try {
      const res = await fetch('/api/pack-issues/alerts', { cache: 'no-store' })
      if (!res.ok) return
      const body = (await res.json()) as { issues: AlertIssue[] }
      const list = body.issues ?? []
      const first = seen.current === null
      const fresh = first ? [] : list.filter((i) => !seen.current!.has(i.issue_id))
      seen.current = new Set(list.map((i) => i.issue_id))
      setIssues(list)
      if (fresh.length > 0) {
        setMinimized(false)
        chime()
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.hidden) {
          const i = fresh[0]
          new Notification(`Station ${i.station_code ?? '—'} แจ้งปัญหา`, { body: `${i.reasons.join(', ')} · Order ${i.order_no} · ${i.packer}`, tag: i.issue_id })
        }
      }
    } catch {
      /* offline -- try again next tick */
    }
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, POLL_MS)
    return () => clearInterval(t)
  }, [poll])

  async function acknowledge(id: string) {
    setBusyId(id)
    setError(null)
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => undefined)
    try {
      const res = await fetch(`/api/pack-issues/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'acknowledge' }) })
      const body = await res.json()
      if (!res.ok) setError(body.error)
      await poll()
      router.push(`/pack-issues?issue=${id}`)
    } finally {
      setBusyId(null)
    }
  }

  function view(id: string) {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') Notification.requestPermission().catch(() => undefined)
    router.push(`/pack-issues?issue=${id}`)
  }

  if (issues.length === 0) return null

  if (minimized) {
    return (
      <button
        onClick={() => setMinimized(false)}
        className="btn btn-danger"
        style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 900, boxShadow: '0 6px 20px rgba(0,0,0,.2)' }}
      >
        ⚠ ปัญหาจากการแพ็ก {issues.length} เรื่อง
      </button>
    )
  }

  return (
    <div style={{ position: 'fixed', right: 20, bottom: 20, zIndex: 900, width: 340, display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-secondary btn-sm" onClick={() => setMinimized(true)} title="ย่อไว้ (ยังแจ้งเตือนเมื่อมีเรื่องใหม่)">
          ย่อ
        </button>
      </div>
      {issues.slice(0, 3).map((i) => (
        <div key={i.issue_id} style={{ background: 'var(--color-surface)', border: '2px solid var(--color-danger)', borderRadius: 12, padding: 12, boxShadow: '0 8px 24px rgba(0,0,0,.18)' }}>
          <div style={{ color: 'var(--color-danger-dark)', fontWeight: 800, fontSize: 14 }}>⚠ Station {i.station_code ?? '—'} แจ้งปัญหา</div>
          <div style={{ fontSize: 13, margin: '4px 0 2px', fontWeight: 600 }}>{i.reasons.join(', ') || '—'}</div>
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
            Order {i.order_no} · {i.pieces} ชิ้น · {i.packer} · {ago(i.reported_at)}
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <button className="btn btn-secondary btn-sm" style={{ flex: 1 }} onClick={() => view(i.issue_id)}>
              ดูรายละเอียด
            </button>
            <button className="btn btn-primary btn-sm" style={{ flex: 1 }} disabled={busyId !== null} onClick={() => acknowledge(i.issue_id)}>
              รับเรื่อง
            </button>
          </div>
        </div>
      ))}
      {issues.length > 3 && <div style={{ fontSize: 12, textAlign: 'right', color: 'var(--color-danger-dark)', fontWeight: 600 }}>และอีก {issues.length - 3} เรื่อง</div>}
      {error && <div style={{ fontSize: 12, color: 'var(--color-danger)', background: 'var(--color-surface)', padding: 6, borderRadius: 6 }}>{error}</div>}
    </div>
  )
}
