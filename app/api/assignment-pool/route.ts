import { NextResponse } from 'next/server'
import { getSessionUser } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { getAssignmentBacklogByDate, getAssignmentZoneDensity, getAssignmentComplexity, getAssignmentPoolOrders, findAssignablePoolOrderByOrderNo } from '@/lib/queries/assignmentPool'

/**
 * Backs the Work Assignment page's Criteria drill-down (Backlog by Order Date -> Zone -> read of
 * order complexity, plus the Unassigned Order Pool list for whatever's been selected so far, plus
 * a standalone Order Barcode scan). One GET endpoint that returns progressively more as query
 * params narrow the selection, rather than a separate route per drill-down level.
 */
export async function GET(request: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Not signed in' }, { status: 403 })

  const { searchParams } = new URL(request.url)
  const warehouseCode = user.warehouse_code ?? 'DC002'
  const orderDate = searchParams.get('order_date')
  const zoneCode = searchParams.get('zone_code')
  const orderNo = searchParams.get('order_no')
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)

  const admin = createAdminClient()

  if (orderNo) {
    const scannedOrder = await findAssignablePoolOrderByOrderNo(admin, warehouseCode, orderNo)
    return NextResponse.json({ scannedOrder })
  }

  const backlogByDate = await getAssignmentBacklogByDate(admin, warehouseCode)

  if (!orderDate) {
    return NextResponse.json({ backlogByDate })
  }

  const zoneDensity = await getAssignmentZoneDensity(admin, warehouseCode, orderDate)

  if (!zoneCode) {
    return NextResponse.json({ backlogByDate, zoneDensity })
  }

  const [{ bands, thresholds }, pool] = await Promise.all([
    getAssignmentComplexity(admin, warehouseCode, orderDate, zoneCode),
    getAssignmentPoolOrders(admin, warehouseCode, orderDate, zoneCode, page),
  ])

  return NextResponse.json({ backlogByDate, zoneDensity, complexity: bands, thresholds, orders: pool.orders, totalOrders: pool.total, page })
}
