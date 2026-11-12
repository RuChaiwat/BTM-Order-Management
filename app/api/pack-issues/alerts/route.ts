import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

/** Polled every ~15s by <PackIssueAlert> on every page of a Pack Supervisor: issues nobody has
 * taken yet (status 'open'), newest first, for the pop-up. */
export async function GET() {
  let caller
  try {
    caller = await requireRole(['system_admin', 'pack_supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }
  const admin = createAdminClient()
  let q = admin.from('pack_issues').select('issue_id, order_id, station_code, picker_id, reported_at').eq('status', 'open').order('reported_at', { ascending: false }).limit(5)
  if (caller.warehouse_code) q = q.eq('warehouse_code', caller.warehouse_code)
  const { data: issues } = await q
  const list = issues ?? []
  if (list.length === 0) return NextResponse.json({ issues: [] }, { headers: { 'Cache-Control': 'no-store' } })

  const [{ data: orders }, { data: lines }, { data: reasons }, { data: pickers }] = await Promise.all([
    admin.from('orders').select('order_id, order_no').in('order_id', list.map((i) => i.order_id)),
    admin.from('pack_issue_lines').select('issue_id, reason_code, qty').in('issue_id', list.map((i) => i.issue_id)),
    admin.from('pack_issue_reasons').select('reason_code, label_th, label_en'),
    admin.from('pickers').select('picker_id, name_th, name_en').in('picker_id', list.map((i) => i.picker_id ?? '')),
  ])
  const orderNo = new Map((orders ?? []).map((o) => [o.order_id, o.order_no]))
  const label = new Map((reasons ?? []).map((r) => [r.reason_code, r.label_th || r.label_en]))
  const pickerName = new Map((pickers ?? []).map((p) => [p.picker_id, p.name_th || p.name_en]))
  return NextResponse.json(
    {
      issues: list.map((i) => {
        const ls = (lines ?? []).filter((l) => l.issue_id === i.issue_id)
        return {
          issue_id: i.issue_id,
          order_no: orderNo.get(i.order_id) ?? '—',
          station_code: i.station_code,
          packer: i.picker_id ? `${i.picker_id} ${pickerName.get(i.picker_id) ?? ''}`.trim() : '—',
          reasons: [...new Set(ls.map((l) => label.get(l.reason_code) ?? l.reason_code))],
          pieces: ls.reduce((s, l) => s + Number(l.qty), 0),
          reported_at: i.reported_at,
        }
      }),
    },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
