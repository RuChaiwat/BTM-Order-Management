'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { ROLE_LABELS } from '../../lib/roles'
import { createClient } from '../../lib/supabase/client'
import { USER_ID_MAX_LENGTH } from '../../lib/authEmail'

interface WorkerRow {
  user_id: string
  name_en: string
  name_th: string | null
  email: string | null
  role: string
  warehouse_code: string | null
  zone_scope: string[]
  active: boolean
  shift_label: string | null
  pcsPerHour: number | null
  completedCount: number
  shortPickRate: number | null
}

const ROLES = ['system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'zone_controller', 'picker', 'viewer']

export function WorkerManagementBoard({ users, warehouseCode }: { users: WorkerRow[]; warehouseCode: string }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(users[0]?.user_id ?? '')
  const [showAdd, setShowAdd] = useState(false)
  const [auditTrail, setAuditTrail] = useState<{ id: string; action: string; created_at: string }[]>([])
  const selected = users.find((u) => u.user_id === selectedId)

  useEffect(() => {
    if (!selected) return
    const supabase = createClient()
    supabase
      .from('audit_logs')
      .select('id, action, created_at')
      .eq('entity_type', 'employees_users')
      .eq('entity_id', selected.user_id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setAuditTrail(data ?? []))
  }, [selected])

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
      <div className="card" style={{ minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="card-title">User List</span>
          <span className="card-subtitle">{users.length} users · {warehouseCode}</span>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowAdd(true)}>
            + Add user
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>USER ID</th>
              <th>NAME</th>
              <th>ROLE</th>
              <th>SCOPE</th>
              <th>PCS/HR (7D)</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.user_id} className={u.user_id === selectedId ? 'row-muted' : undefined} onClick={() => setSelectedId(u.user_id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 700 }}>{u.user_id}</td>
                <td>
                  {u.name_en}
                  {u.name_th && <div style={{ fontSize: 11, color: '#6B7280' }}>{u.name_th}</div>}
                </td>
                <td>
                  <span className="badge badge-info">{ROLE_LABELS[u.role] ?? u.role}</span>
                </td>
                <td>{u.zone_scope.length > 0 ? `Zones ${u.zone_scope.join(', ')}` : 'All zones'}</td>
                <td style={{ fontWeight: u.pcsPerHour ? 700 : 400, color: u.pcsPerHour ? undefined : '#6B7280' }}>{u.pcsPerHour ?? '—'}</td>
                <td>{u.active ? <span style={{ color: '#16A34A' }}>● Active</span> : <span style={{ color: '#9CA3AF' }}>● Inactive</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="card" style={{ minHeight: 0 }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <div style={{ width: 48, height: 48, borderRadius: '50%', background: '#F3F4F6', flex: 'none' }} />
              <div>
                <div style={{ fontSize: 15, fontWeight: 700 }}>{selected.name_en}</div>
                <div style={{ fontSize: 11.5, color: '#6B7280' }}>
                  {selected.name_th ?? ''} · {selected.user_id}
                </div>
                <span className="badge badge-info" style={{ marginTop: 4 }}>
                  {ROLE_LABELS[selected.role] ?? selected.role}
                </span>
              </div>
            </div>
            <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>7-day productivity</div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontSize: 12 }}>
                <div>
                  <span style={{ color: '#6B7280' }}>Pcs / hour</span>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{selected.pcsPerHour ?? '—'}</div>
                </div>
                <div>
                  <span style={{ color: '#6B7280' }}>Orders completed</span>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{selected.completedCount}</div>
                </div>
                <div>
                  <span style={{ color: '#6B7280' }}>Short pick rate</span>
                  <div style={{ fontSize: 17, fontWeight: 700 }}>{selected.shortPickRate !== null ? `${selected.shortPickRate}%` : '—'}</div>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Audit Trail</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              {auditTrail.map((a) => (
                <div key={a.id}>
                  {new Date(a.created_at).toLocaleString()} · {a.action}
                </div>
              ))}
              {auditTrail.length === 0 && <span style={{ color: '#6B7280' }}>No recorded actions.</span>}
            </div>
          </>
        ) : (
          <span style={{ color: '#6B7280' }}>No users yet — add one to get started.</span>
        )}
      </div>

      {showAdd && <AddUserModal warehouseCode={warehouseCode} onClose={() => setShowAdd(false)} onCreated={() => { setShowAdd(false); router.refresh() }} />}
    </div>
  )
}

function AddUserModal({ warehouseCode, onClose, onCreated }: { warehouseCode: string; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ user_id: '', email: '', password: '', name_en: '', role: 'picker' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, warehouse_code: warehouseCode }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    onCreated()
  }

  return (
    <Modal title="Add user" subtitle="เพิ่มผู้ใช้งาน">
      <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label className="field-label">
            User ID <span className="field-hint">used to sign in — max {USER_ID_MAX_LENGTH} characters</span>
          </label>
          <input
            className="field-input"
            value={form.user_id}
            maxLength={USER_ID_MAX_LENGTH}
            onChange={(e) => setForm({ ...form, user_id: e.target.value.toUpperCase() })}
            placeholder="e.g. P020"
            style={{ border: '1px solid var(--color-border)' }}
          />
        </div>
        <div className="field">
          <label className="field-label">Name</label>
          <input className="field-input" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">
            Email <span className="field-hint">optional — contact only, not used to sign in</span>
          </label>
          <input className="field-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Temporary password</label>
          <input className="field-input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">Role</label>
          <select className="field-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={{ border: '1px solid var(--color-border)' }}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </div>
        {error && <div style={{ fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}
      </div>
      <ModalFooter>
        <button className="modal-footer-btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          className="modal-footer-btn btn-primary"
          style={{ minWidth: 140, border: 0 }}
          disabled={busy || !form.user_id || !form.password || !form.name_en}
          onClick={submit}
        >
          {busy ? 'Creating…' : 'Create user'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
