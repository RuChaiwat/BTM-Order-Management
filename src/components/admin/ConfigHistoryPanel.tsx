import { CONFIG_CATEGORIES, CONFIG_FIELDS, toDisplayValue } from '@/lib/configCatalog'
import { formatDateTime } from '@/lib/formatDate'

interface ConfigVersionRow {
  key: string
  value: unknown
  version: number
  changed_by: string | null
  changed_at: string
  change_reason: string | null
}

/** Configuration's own change history, grouped the same way as the Settings card above it --
 * deliberately separate from the general Audit Trail (which also covers orders/batches/etc, an
 * unrelated concern). Only the single most recent change per setting is shown (current value vs.
 * the one version before it), not the full version history -- enough to answer "what did this
 * used to be" without turning into another long table to scroll through. */
export function ConfigHistoryPanel({ versions }: { versions: ConfigVersionRow[] }) {
  const byKey = new Map<string, ConfigVersionRow[]>()
  for (const v of versions) {
    if (!byKey.has(v.key)) byKey.set(v.key, [])
    byKey.get(v.key)!.push(v)
  }
  for (const rows of byKey.values()) rows.sort((a, b) => b.version - a.version)

  const changedCategories = CONFIG_CATEGORIES.map((cat) => ({
    cat,
    fields: CONFIG_FIELDS.filter((f) => f.category === cat.id && (byKey.get(f.key)?.length ?? 0) > 1),
  })).filter((c) => c.fields.length > 0)

  return (
    <div className="card">
      <div className="card-title">Configuration History</div>
      <div className="card-subtitle" style={{ marginBottom: 12 }}>
        ประวัติการแก้ไขค่าตั้งค่า · แสดงเฉพาะค่าก่อนหน้าล่าสุด 1 ครั้ง
      </div>
      {changedCategories.length === 0 && <div style={{ color: 'var(--color-text-secondary)', fontSize: 13 }}>No settings have been changed from their defaults yet.</div>}
      {changedCategories.map(({ cat, fields }) => (
        <div key={cat.id} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 13, fontWeight: 700 }}>
            {cat.labelEn} <span style={{ fontWeight: 400, color: 'var(--color-text-secondary)' }}>· {cat.labelTh}</span>
          </div>
          <table className="table" style={{ marginTop: 6, tableLayout: 'fixed', width: '100%' }}>
            <colgroup>
              <col style={{ width: '22%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '14%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '16%' }} />
              <col style={{ width: '22%' }} />
            </colgroup>
            <thead>
              <tr>
                <th>SETTING</th>
                <th>
                  PREVIOUS
                  <br />
                  VALUE
                </th>
                <th>
                  CURRENT
                  <br />
                  VALUE
                </th>
                <th>
                  CHANGED
                  <br />
                  BY
                </th>
                <th>
                  CHANGED
                  <br />
                  AT
                </th>
                <th>REASON</th>
              </tr>
            </thead>
            <tbody>
              {fields.map((field) => {
                const [current, previous] = byKey.get(field.key)!
                return (
                  <tr key={field.key}>
                    <td>
                      <div style={{ fontWeight: 600 }}>{field.labelEn}</div>
                      <div style={{ fontSize: 11.5, color: 'var(--color-text-secondary)' }}>{field.labelTh}</div>
                    </td>
                    <td style={{ color: 'var(--color-text-secondary)', overflowWrap: 'break-word' }}>
                      {toDisplayValue(field.kind, previous.value)} {field.unit}
                    </td>
                    <td style={{ fontWeight: 700, overflowWrap: 'break-word' }}>
                      {toDisplayValue(field.kind, current.value)} {field.unit}
                    </td>
                    <td>{current.changed_by ?? '—'}</td>
                    <td>{formatDateTime(current.changed_at)}</td>
                    <td style={{ overflowWrap: 'break-word' }}>{current.change_reason ?? '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  )
}
