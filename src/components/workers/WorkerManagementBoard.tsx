'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Pagination } from '@/components/Pagination'
import { Avatar } from '@/components/Avatar'
import { ROLE_LABELS, canManageUserRole } from '../../lib/roles'
import { createClient } from '../../lib/supabase/client'
import { USER_ID_MAX_LENGTH } from '../../lib/authEmail'
import { formatDateTime } from '../../lib/formatDate'

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
}

// 'picker' deliberately excluded -- see /api/pickers and app/pickers for Picker management.
// 'planner_admin' retired (migration 0032), merged into 'supervisor'.
const ROLES = ['system_admin', 'warehouse_manager', 'supervisor', 'zone_controller', 'viewer']

const PAGE_SIZE = 20

export function WorkerManagementBoard({ users, warehouseCode, currentUserRole }: { users: WorkerRow[]; warehouseCode: string; currentUserRole: string }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(users[0]?.user_id ?? '')
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(false)
  const [auditTrail, setAuditTrail] = useState<{ id: string; action: string; created_at: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = users.find((u) => u.user_id === selectedId)

  const totalPages = Math.max(1, Math.ceil(users.length / PAGE_SIZE))
  const pageRows = users.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  useEffect(() => {
    setEditing(false)
    setError(null)
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
  }, [selected?.user_id])

  const canManageSelected = selected ? canManageUserRole(currentUserRole, selected.role) : false

  async function toggleActive() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/users', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: selected.user_id, active: !selected.active }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    router.refresh()
  }

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
        <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
          <colgroup>
            <col style={{ width: '12%' }} />
            <col style={{ width: '26%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '28%' }} />
            <col style={{ width: '18%' }} />
          </colgroup>
          <thead>
            <tr>
              <th>USER ID</th>
              <th>NAME</th>
              <th>ROLE</th>
              <th>SCOPE</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {pageRows.map((u) => (
              <tr key={u.user_id} className={u.user_id === selectedId ? 'row-muted' : undefined} onClick={() => setSelectedId(u.user_id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 700 }}>{u.user_id}</td>
                <td style={{ overflowWrap: 'break-word' }}>
                  {u.name_en}
                  {u.name_th && <div style={{ fontSize: 11, color: '#6B7280' }}>{u.name_th}</div>}
                </td>
                <td>
                  <span className="badge badge-info">{ROLE_LABELS[u.role] ?? u.role}</span>
                </td>
                <td style={{ overflowWrap: 'break-word' }}>{u.zone_scope.length > 0 ? `Zones ${u.zone_scope.join(', ')}` : 'All zones'}</td>
                <td>{u.active ? <span style={{ color: '#16A34A' }}>● Active</span> : <span style={{ color: '#9CA3AF' }}>● Inactive</span>}</td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                  No users yet — add one to get started.
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {users.length > 0 && <Pagination page={page} totalPages={totalPages} onChange={setPage} />}
      </div>

      <div className="card" style={{ minHeight: 0 }}>
        {selected ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
              <Avatar name={selected.name_en} seed={selected.user_id} />
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

            {error && <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}

            {canManageSelected ? (
              <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(true)}>
                  Edit
                </button>
                <button className="btn btn-secondary btn-sm" disabled={busy} onClick={toggleActive}>
                  {selected.active ? 'Deactivate' : 'Reactivate'}
                </button>
              </div>
            ) : (
              <div style={{ marginBottom: 16, fontSize: 11.5, color: 'var(--color-text-secondary)' }}>
                Only a System Admin can edit or deactivate another System Admin account.
              </div>
            )}

            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Audit Trail</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12 }}>
              {auditTrail.map((a) => (
                <div key={a.id}>
                  {formatDateTime(a.created_at)} · {a.action}
                </div>
              ))}
              {auditTrail.length === 0 && <span style={{ color: '#6B7280' }}>No recorded actions.</span>}
            </div>
          </>
        ) : (
          <span style={{ color: '#6B7280' }}>No users yet — add one to get started.</span>
        )}
      </div>

      {showAdd && <UserModal warehouseCode={warehouseCode} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); router.refresh() }} />}
      {editing && selected && canManageSelected && (
        <UserModal warehouseCode={warehouseCode} user={selected} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh() }} />
      )}
    </div>
  )
}

function UserModal({
  warehouseCode,
  user,
  onClose,
  onSaved,
}: {
  warehouseCode: string
  user?: WorkerRow
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = Boolean(user)
  const [form, setForm] = useState({
    user_id: user?.user_id ?? '',
    email: user?.email ?? '',
    password: '',
    name_en: user?.name_en ?? '',
    name_th: user?.name_th ?? '',
    role: user?.role ?? 'viewer',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/users', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isEdit
          ? { user_id: form.user_id, name_en: form.name_en, name_th: form.name_th || null, email: form.email || null, role: form.role }
          : { ...form, warehouse_code: warehouseCode },
      ),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    onSaved()
  }

  return (
    <Modal title={isEdit ? 'Edit user' : 'Add user'} subtitle={isEdit ? 'แก้ไขผู้ใช้งาน' : 'เพิ่มผู้ใช้งาน'} onSubmit={submit}>
      <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label className="field-label">
            User ID {!isEdit && <span className="field-hint">used to sign in — max {USER_ID_MAX_LENGTH} characters</span>}
          </label>
          <input
            className="field-input"
            value={form.user_id}
            maxLength={USER_ID_MAX_LENGTH}
            disabled={isEdit}
            onChange={(e) => setForm({ ...form, user_id: e.target.value.toUpperCase() })}
            placeholder="e.g. U0005"
            style={{ border: '1px solid var(--color-border)' }}
            autoFocus={!isEdit}
          />
        </div>
        <div className="field">
          <label className="field-label">Name (EN)</label>
          <input
            className="field-input"
            value={form.name_en}
            onChange={(e) => setForm({ ...form, name_en: e.target.value })}
            style={{ border: '1px solid var(--color-border)' }}
            autoFocus={isEdit}
          />
        </div>
        <div className="field">
          <label className="field-label">
            Name (TH) <span className="field-hint">optional</span>
          </label>
          <input className="field-input" value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">
            Email <span className="field-hint">optional — contact only, not used to sign in</span>
          </label>
          <input className="field-input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        {!isEdit && (
          <div className="field">
            <label className="field-label">Temporary password</label>
            <input className="field-input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
          </div>
        )}
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
        <button type="button" className="modal-footer-btn btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button
          type="submit"
          className="modal-footer-btn btn-primary"
          style={{ minWidth: 140, border: 0 }}
          disabled={busy || !form.user_id || !form.name_en || (!isEdit && !form.password)}
        >
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
