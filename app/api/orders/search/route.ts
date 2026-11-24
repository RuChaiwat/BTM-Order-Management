import { NextResponse } from 'next/server'
import { orderStatusTh } from '@/lib/apiError'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'

const PAGE_SIZE = 20

/** GET ?q=...&page=N -- Order Pool's Cancel Order search. Part of an Order No or Store Code, this
 * caller's warehouse, newest first, 20 per page. Every match is listed (any status) so the user
 * can see why an order can't be cancelled; only status 'new' gets a working Cancel button. */
export async function GET(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { searchParams } = new URL(request.url)
  // PostgREST filter syntax uses , ( ) and * -- drop them so a typed value can't break the filter.
  const q = (searchParams.get('q') ?? '').replace(/[,()*%\\"]/g, '').trim()
  if (!q) return NextResponse.json({ error: 'กรุณากรอก Order No หรือ Store Code' }, { status: 400 })
  const page = Math.max(1, Number(searchParams.get('page')) || 1)

  const admin = createAdminClient()
  const warehouseCode = caller.warehouse_code ?? 'DC002'
  const from = (page - 1) * PAGE_SIZE
  const { data, count, error } = await admin
    .from('orders')
    .select('order_id, order_no, store_code, original_order_date, planned_pieces, unique_sku_count, status', { count: 'exact' })
    .eq('warehouse_code', warehouseCode)
    .or(`order_no.ilike.*${q}*,store_code.ilike.*${q}*`)
    .order('created_at', { ascending: false })
    .order('order_no')
    .range(from, from + PAGE_SIZE - 1)
  if (error) {
    console.error('[orders/search]', error.message)
    return NextResponse.json({ error: 'ค้นหา Order ไม่สำเร็จ กรุณาลองใหม่' }, { status: 500 })
  }

  return NextResponse.json({
    rows: (data ?? []).map((o) => ({ ...o, status_th: orderStatusTh(o.status) })),
    total: count ?? 0,
    page,
    totalPages: Math.max(1, Math.ceil((count ?? 0) / PAGE_SIZE)),
  })
}
