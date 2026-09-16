'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Modal, ModalFooter } from '../Modal'
import { createClient } from '../../lib/supabase/client'
import { USER_ID_MAX_LENGTH } from '../../lib/authEmail'
import { formatDateTime } from '../../lib/formatDate'
import { productivityMeta } from '../../lib/pickerProductivity'

interface PickerRow {
  picker_id: string
  name_en: string
  name_th: string | null
  warehouse_code: string | null
  zone_scope: string[]
  active: boolean
  shift_label: string | null
  note: string | null
  productivity_level: string | null
  productivity_pcs_per_hour: number | null
  productivity_updated_at: string | null
  created_at: string
}

function ProductivityBadge({ picker }: { picker: PickerRow }) {
  const meta = productivityMeta(picker.productivity_level)
  return (
    <span
      className="badge"
      style={{ background: meta.bg, color: meta.color, fontWeight: 700 }}
      title={picker.productivity_pcs_per_hour ? `${picker.productivity_pcs_per_hour.toLocaleString()} pcs/hr avg` : undefined}
    >
      {meta.label}
    </span>
  )
}

/** Pickers have their own table (migration 0015) with no login capability at all -- no auth
 * account, no password, no email. Admin manages them here purely as a roster: a Picker ID (the
 * same ID printed on the picker's employee card) and a name -- Work Assignment scans that same ID
 * directly to resolve a name when assigning work (migration 0018 dropped a separate "Badge Code"
 * after UAT feedback that it read like an achievement badge, not an ID card number). */
export function PickerManagementBoard({ pickers, warehouseCode }: { pickers: PickerRow[]; warehouseCode: string }) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(pickers[0]?.picker_id ?? '')
  const [showAdd, setShowAdd] = useState(false)
  const [editing, setEditing] = useState(false)
  const [auditTrail, setAuditTrail] = useState<{ id: string; action: string; created_at: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selected = pickers.find((p) => p.picker_id === selectedId)

  useEffect(() => {
    setEditing(false)
    setError(null)
    if (!selected) return
    const supabase = createClient()
    supabase
      .from('audit_logs')
      .select('id, action, created_at')
      .eq('entity_type', 'pickers')
      .eq('entity_id', selected.picker_id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => setAuditTrail(data ?? []))
  }, [selected?.picker_id])

  async function toggleActive() {
    if (!selected) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/pickers', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ picker_id: selected.picker_id, active: !selected.active }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    router.refresh()
  }

  async function remove() {
    if (!selected) return
    if (!confirm(`Remove ${selected.name_en} (${selected.picker_id})? This can't be undone.`)) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/pickers', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ picker_id: selected.picker_id }),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    setSelectedId(pickers.find((p) => p.picker_id !== selected.picker_id)?.picker_id ?? '')
    router.refresh()
  }

  return (
    <div className="page-body" style={{ display: 'grid', gridTemplateColumns: '1fr 340px', gap: 16 }}>
      <div className="card" style={{ minHeight: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <span className="card-title">Picker List</span>
          <span className="card-subtitle">{pickers.length} pickers · {warehouseCode}</span>
          <button className="btn btn-primary btn-sm" style={{ marginLeft: 'auto' }} onClick={() => setShowAdd(true)}>
            + Add picker
          </button>
        </div>
        <table className="table">
          <thead>
            <tr>
              <th>PICKER ID</th>
              <th>NAME</th>
              <th>SCOPE</th>
              <th>PRODUCTIVITY</th>
              <th>STATUS</th>
            </tr>
          </thead>
          <tbody>
            {pickers.map((p) => (
              <tr key={p.picker_id} className={p.picker_id === selectedId ? 'row-muted' : undefined} onClick={() => setSelectedId(p.picker_id)} style={{ cursor: 'pointer' }}>
                <td style={{ fontWeight: 700 }}>{p.picker_id}</td>
                <td>
                  {p.name_en}
                  {p.name_th && <div style={{ fontSize: 11, color: '#6B7280' }}>{p.name_th}</div>}
                </td>
                <td>{p.zone_scope.length > 0 ? `Zones ${p.zone_scope.join(', ')}` : 'All zones'}</td>
                <td>
                  <ProductivityBadge picker={p} />
                </td>
                <td>{p.active ? <span style={{ color: '#16A34A' }}>● Active</span> : <span style={{ color: '#9CA3AF' }}>● Inactive</span>}</td>
              </tr>
            ))}
            {pickers.length === 0 && (
              <tr>
                <td colSpan={5} style={{ color: 'var(--color-text-secondary)' }}>
                  No pickers yet — add one to get started.
                </td>
              </tr>
            )}
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
                  {selected.name_th ?? ''} · {selected.picker_id}
                </div>
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Productivity rating</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <ProductivityBadge picker={selected} />
                {selected.productivity_pcs_per_hour != null && <span style={{ fontSize: 12, color: '#6B7280' }}>{selected.productivity_pcs_per_hour.toLocaleString()} pcs/hr avg</span>}
              </div>
              <div style={{ fontSize: 11, color: '#9CA3AF', marginTop: 4 }}>
                {selected.productivity_updated_at ? `Updated ${formatDateTime(selected.productivity_updated_at)}` : 'Not yet computed'} · auto-calculated every Sunday, not editable
              </div>
            </div>

            {selected.note && (
              <div style={{ background: 'var(--color-surface-muted)', borderRadius: 8, padding: '10px 12px', marginBottom: 16, fontSize: 12.5, color: '#374151', whiteSpace: 'pre-wrap' }}>
                {selected.note}
              </div>
            )}

            {error && <div style={{ marginBottom: 12, fontSize: 12, color: 'var(--color-danger)' }}>{error}</div>}

            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={() => setEditing(true)}>
                Edit
              </button>
              <button className="btn btn-secondary btn-sm" disabled={busy} onClick={toggleActive}>
                {selected.active ? 'Deactivate' : 'Reactivate'}
              </button>
              <button className="btn btn-danger btn-sm" disabled={busy} onClick={remove}>
                Delete
              </button>
            </div>

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
          <span style={{ color: '#6B7280' }}>No pickers yet — add one to get started.</span>
        )}
      </div>

      {showAdd && <PickerModal warehouseCode={warehouseCode} onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); router.refresh() }} />}
      {editing && selected && (
        <PickerModal warehouseCode={warehouseCode} picker={selected} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); router.refresh() }} />
      )}
    </div>
  )
}

function PickerModal({
  warehouseCode,
  picker,
  onClose,
  onSaved,
}: {
  warehouseCode: string
  picker?: PickerRow
  onClose: () => void
  onSaved: () => void
}) {
  const isEdit = Boolean(picker)
  const [form, setForm] = useState({
    picker_id: picker?.picker_id ?? '',
    name_en: picker?.name_en ?? '',
    name_th: picker?.name_th ?? '',
    note: picker?.note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/pickers', {
      method: isEdit ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        isEdit
          ? { picker_id: form.picker_id, name_en: form.name_en, name_th: form.name_th || null, note: form.note || null }
          : { ...form, note: form.note || null, warehouse_code: warehouseCode },
      ),
    })
    const body = await res.json()
    setBusy(false)
    if (!res.ok) return setError(body.error)
    onSaved()
  }

  return (
    <Modal title={isEdit ? 'Edit picker' : 'Add picker'} subtitle={isEdit ? 'แก้ไขพนักงานหยิบสินค้า' : 'เพิ่มพนักงานหยิบสินค้า'}>
      <div style={{ padding: '16px 24px 0', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div className="field">
          <label className="field-label">
            Picker ID <span className="field-hint">max {USER_ID_MAX_LENGTH} characters — same ID printed on the picker's employee card, scanned directly at Assignment time — cannot be changed later</span>
          </label>
          <input
            className="field-input"
            value={form.picker_id}
            maxLength={USER_ID_MAX_LENGTH}
            disabled={isEdit}
            onChange={(e) => setForm({ ...form, picker_id: e.target.value.toUpperCase() })}
            placeholder="e.g. P020"
            style={{ border: '1px solid var(--color-border)' }}
          />
        </div>
        <div className="field">
          <label className="field-label">Name (EN)</label>
          <input className="field-input" value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">
            Name (TH) <span className="field-hint">optional</span>
          </label>
          <input className="field-input" value={form.name_th} onChange={(e) => setForm({ ...form, name_th: e.target.value })} style={{ border: '1px solid var(--color-border)' }} />
        </div>
        <div className="field">
          <label className="field-label">
            Note <span className="field-hint">optional — e.g. employee type, distinction, certification. Informational only, not used to look the picker up</span>
          </label>
          <textarea
            className="field-input"
            rows={3}
            value={form.note}
            onChange={(e) => setForm({ ...form, note: e.target.value })}
            style={{ border: '1px solid var(--color-border)', resize: 'vertical' }}
          />
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
          disabled={busy || !form.picker_id || !form.name_en}
          onClick={submit}
        >
          {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create picker'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
