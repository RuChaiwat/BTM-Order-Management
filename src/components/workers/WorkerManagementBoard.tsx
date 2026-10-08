'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { Pagination } from '@/components/Pagination'
import { Avatar } from '@/components/Avatar'
import { ROLE_LABELS, canManageUserRole, canAccessMenuItem } from '../../lib/roles'
import { NAV_GROUPS } from '../../data/navigation'
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

// One-line summary of each role's actual action-level permissions (requireRole([...]) across the
// API routes) -- kept here as a human-readable cross-check next to the menu-access list below, so
// it has to be manually kept in sync if a role's permissions change, same judgment call already
// flagged in src/lib/roles.ts's own comments.
const ROLE_SUMMARY: Record<string, string> = {
  system_admin: 'สิทธิ์เต็มทุกอย่าง — role เดียวที่จัดการ User Management, Location Master, Configuration ได้ และแก้ไข/ปิดใช้งาน System Admin คนอื่นได้',
  warehouse_manager: 'กำกับดูแลภาพรวม จัดการ Picker Management และ User Management ได้ (สร้าง/แก้ไข/Deactivate — ยกเว้นบัญชี System Admin) แต่ไม่มีสิทธิ์ Run Matching, Approve/Reject Verification, Work Assignment, หรือ Cancel/Unassign Order',
  supervisor: 'คุมงานปฏิบัติการเต็มรูปแบบ — Matching, Admin Verification, Work Assignment, Cancel/Unassign Order, Picker Management, Reason Master — ยกเว้น User Management และ Location Master',
  zone_controller: 'จำกัดเฉพาะโซนที่รับผิดชอบ (ดู Scope) ทำ action ได้แค่บันทึก Pick Completion แทนพนักงาน ที่เหลือดูได้อย่างเดียว',
  viewer: 'ดูรายงาน/dashboard ได้เท่านั้น ทำ action ใดๆ ในระบบไม่ได้เลย',
}

function screensForRole(role: string): { accessible: string[]; blocked: string[] } {
  const accessible: string[] = []
  const blocked: string[] = []
  for (const group of NAV_GROUPS) {
    for (const item of group.items) {
      ;(canAccessMenuItem(role, item.id) ? accessible : blocked).push(item.en)
    }
  }
  return { accessible, blocked }
}

function RoleScopeReference() {
  return (
    <div className="card">
      <div className="card-title">Role &amp; Scope</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>คำอธิบายสิทธิ์การใช้งานของแต่ละ Role — Scope คือหน้าจอที่เข้าได้/เข้าไม่ได้ (คนละเรื่องกับ Scope ของโซนในตาราง User List ด้านบน)</div>
      <table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
        <colgroup>
          <col style={{ width: '24%' }} />
          <col style={{ width: '76%' }} />
        </colgroup>
        <thead>
          <tr>
            <th>ROLE</th>
            <th>SCOPE</th>
          </tr>
        </thead>
        <tbody>
          {ROLES.map((r) => {
            const { accessible, blocked } = screensForRole(r)
            return (
              <tr key={r}>
                <td style={{ verticalAlign: 'top' }}>
                  <span className="badge badge-info" style={{ marginBottom: 6 }}>
                    {ROLE_LABELS[r]}
                  </span>
                  <div style={{ fontSize: 11.5, color: '#374151', marginTop: 6 }}>{ROLE_SUMMARY[r]}</div>
                </td>
                <td style={{ verticalAlign: 'top', overflowWrap: 'break-word' }}>
                  <div style={{ fontSize: 11.5, marginBottom: 6 }}>
                    <span style={{ color: '#16A34A', fontWeight: 700 }}>เข้าได้:</span> {accessible.join(', ')}
                  </div>
                  <div style={{ fontSize: 11.5 }}>
                    <span style={{ color: '#9CA3AF', fontWeight: 700 }}>เข้าไม่ได้:</span> {blocked.length > 0 ? blocked.join(', ') : '— (เข้าได้ทุกหน้า)'}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

type SortKey = 'user_id' | 'name_en' | 'role' | 'active'

function sortRows(rows: WorkerRow[], key: SortKey, dir: 'asc' | 'desc'): WorkerRow[] {
  function value(r: WorkerRow): string | number {
    switch (key) {
      case 'user_id':
        return r.user_id
      case 'name_en':
        return r.name_en
      case 'role':
        return ROLE_LABELS[r.role] ?? r.role
      case 'active':
        return r.active ? 1 : 0
    }
  }
  const copy = [...rows]
  copy.sort((a, b) => {
    const av = value(a)
    const bv = value(b)
    const cmp = typeof av === 'string' ? av.localeCompare(bv as string) : (av as number) - (bv as number)
    return dir === 'asc' ? cmp : -cmp
  })
  return copy
}

function SortHeader<K extends string>({ label, sortKey, sort, onSort }: { label: React.ReactNode; sortKey: K; sort: { key: K; dir: 'asc' | 'desc' }; onSort: (key: K) => void }) {
  const active = sort.key === sortKey
  return (
    <th style={{ cursor: 'pointer', userSelect: 'none' }} onClick={() => onSort(sortKey)}>
      {label} <span style={{ opacity: active ? 1 : 0.3 }}>{active ? (sort.dir === 'asc' ? '▲' : '▼') : '▲'}</span>
    </th>
  )
}

const PAGE_SIZE = 20

export function WorkerManagementBoard({ users, warehouseCode, currentUserRole }: { users: WorkerRow[]; warehouseCode: string; currentUserRole: string }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(users[0]?.user_id ?? '')
  const [sort, setSort] = useState<{ key: SortKey; dir: 'asc' | 'desc' }>({ key: 'user_id', dir: 'asc' })
  const [page, setPage] = useState(1)
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(false)
  const [auditTrail, setAuditTrail] = useState<{ id: string; action: string; created_at: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = users.find((u) => u.user_id === selectedId)

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'active' ? 'desc' : 'asc' }))
    setPage(1)
  }

  const sorted = useMemo(() => sortRows(users, sort.key, sort.dir), [users, sort])
  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE))
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

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
    <div className="page-body">
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
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
            <col style={{ width: '16%' }} />
            <col style={{ width: '38%' }} />
            <col style={{ width: '22%' }} />
            <col style={{ width: '24%' }} />
          </colgroup>
          <thead>
            <tr>
              <SortHeader label="USER ID" sortKey="user_id" sort={sort} onSort={toggleSort} />
              <SortHeader label="NAME" sortKey="name_en" sort={sort} onSort={toggleSort} />
              <SortHeader label="ROLE" sortKey="role" sort={sort} onSort={toggleSort} />
              <SortHeader label="STATUS" sortKey="active" sort={sort} onSort={toggleSort} />
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
                <td>{u.active ? <span style={{ color: '#16A34A' }}>● Active</span> : <span style={{ color: '#9CA3AF' }}>● Inactive</span>}</td>
              </tr>
            ))}
            {pageRows.length === 0 && (
              <tr>
                <td colSpan={4} style={{ color: 'var(--color-text-secondary)' }}>
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
    </div>

      <RoleScopeReference />

      {showAdd && <UserModal warehouseCode={warehouseCode} currentUserRole={currentUserRole} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); router.refresh() }} />}
      {editing && selected && canManageSelected && (
        <UserModal warehouseCode={warehouseCode} currentUserRole={currentUserRole} user={selected} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh() }} />
      )}
    </div>
  )
}

function UserModal({
  warehouseCode,
  currentUserRole,
  user,
  onClose,
  onSaved,
}: {
  warehouseCode: string
  currentUserRole: string
  user?: WorkerRow
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = Boolean(user)
  const assignableRoles = ROLES.filter((r) => canManageUserRole(currentUserRole, r))
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
    setError(null)
    const missing: string[] = []
    if (!form.user_id) missing.push('User ID')
    if (!form.name_en) missing.push('Name (EN)')
    if (!form.role) missing.push('Role')
    if (!isEdit && !form.password) missing.push('Temporary password')
    if (missing.length > 0) {
      setError(`กรุณากรอกข้อมูลที่จำเป็น — Required: ${missing.join(', ')}`)
      return
    }

    setBusy(true)
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
            User ID <span className="field-label-required">*</span> {!isEdit && <span className="field-hint">used to sign in — max {USER_ID_MAX_LENGTH} characters</span>}
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
          <label className="field-label">
            Name (EN) <span className="field-label-required">*</span>
          </label>
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
            <label className="field-label">
              Temporary password <span className="field-label-required">*</span>
            </label>
            <input className="field-input" type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
          </div>
        )}
        <div className="field">
          <label className="field-label">
            Role <span className="field-label-required">*</span>
          </label>
          <select className="field-input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} style={{ border: '1px solid var(--color-border)' }}>
            {assignableRoles.map((r) => (
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
        <button type="submit" className="modal-footer-btn btn-primary" style={{ minWidth: 140, border: 0 }} disabled={busy}>
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create user'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
