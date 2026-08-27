import { NextResponse } from 'next/server'
import { requireRole } from '@/lib/auth'
import { createAdminClient } from '@/lib/supabase/admin'
import { writeAudit } from '@/lib/audit'
import { getActiveConfig, MATCHING_CONFIG_KEYS } from '@/lib/queries/config'
import { runMatching, splitGroupIfNeeded, type MatchableOrder, type MatchingConfig } from '@/lib/matching/engine'

/** §10 pre-screen + P1-P4 matching for one Order Date / Warehouse. Creates consolidation_batches
 * as 'candidate' — nothing is released to a pick report yet, that's a separate approve step. */
export async function POST(request: Request) {
  let caller
  try {
    caller = await requireRole(['system_admin', 'supervisor', 'planner_admin'])
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 403 })
  }

  const { warehouse_code, order_date } = await request.json()
  if (!warehouse_code || !order_date) {
    return NextResponse.json({ error: 'warehouse_code and order_date are required' }, { status: 400 })
  }

  const admin = createAdminClient()

  const { data: orders, error: ordersError } = await admin
    .from('orders')
    .select('order_id, store_code, unique_sku_count, planned_pieces')
    .eq('warehouse_code', warehouse_code)
    .eq('original_order_date', order_date)
    .eq('status', 'new')
    .is('consolidation_batch_id', null)
  if (ordersError) return NextResponse.json({ error: ordersError.message }, { status: 400 })
  if (!orders || orders.length === 0) {
    return NextResponse.json({ groups: [], message: 'No eligible orders for this date/warehouse' })
  }

  const orderIds = orders.map((o) => o.order_id)
  const { data: lines } = await admin.from('order_lines').select('order_id, sku').in('order_id', orderIds)
  const skusByOrder = new Map<string, string[]>()
  for (const l of lines ?? []) {
    if (!skusByOrder.has(l.order_id)) skusByOrder.set(l.order_id, [])
    skusByOrder.get(l.order_id)!.push(l.sku)
  }

  const matchable: MatchableOrder[] = orders.map((o) => ({
    orderId: o.order_id,
    storeCode: o.store_code,
    uniqueSkuCount: o.unique_sku_count,
    plannedPieces: o.planned_pieces,
    skus: skusByOrder.get(o.order_id) ?? [],
  }))

  const cfg = await getActiveConfig(admin, MATCHING_CONFIG_KEYS)
  const matchingConfig: MatchingConfig = {
    maxUniqueSku: Number(cfg.value('consolidation.max_unique_sku') ?? 30),
    p1MinPieces: Number(cfg.value('matching.p1_min_pieces') ?? 50),
    p2MatchPct: Number(cfg.value('matching.p2_match_pct') ?? 0.8),
    p2MinPieces: Number(cfg.value('matching.p2_min_pieces') ?? 50),
    p3MatchPct: Number(cfg.value('matching.p3_match_pct') ?? 0.5),
    p3MinPieces: Number(cfg.value('matching.p3_min_pieces') ?? 80),
    p4MatchPct: Number(cfg.value('matching.p4_match_pct') ?? 0.3),
    p4MinPieces: Number(cfg.value('matching.p4_min_pieces') ?? 150),
    minStores: Number(cfg.value('consolidation.min_stores') ?? 2),
    targetStores: Number(cfg.value('consolidation.target_stores') ?? 7),
    maxStores: Number(cfg.value('consolidation.max_stores') ?? 8),
    maxOrders: cfg.value('consolidation.max_orders') ? Number(cfg.value('consolidation.max_orders')) : null,
  }

  const result = runMatching(matchable, matchingConfig)
  const finalGroups = result.groups.flatMap((g) => splitGroupIfNeeded(g, matchable, matchingConfig))

  const createdBatches = []
  for (const group of finalGroups) {
    const { data: batch, error: batchError } = await admin
      .from('consolidation_batches')
      .insert({
        order_date,
        priority: group.priority,
        match_pct: group.matchPct,
        stores_count: group.storeCodes.length,
        orders_count: group.orderIds.length,
        unique_sku_count: group.uniqueSkuCount,
        total_pieces: group.totalPieces,
        config_version: cfg.maxVersion(),
        status: 'candidate',
        created_by: caller.user_id,
      })
      .select()
      .single()
    if (batchError || !batch) continue

    await admin.from('consolidation_orders').insert(group.orderIds.map((orderId, i) => ({ consol_batch_id: batch.consol_batch_id, order_id: orderId, sequence: i + 1 })))
    await admin.from('orders').update({ consolidation_batch_id: batch.consol_batch_id }).in('order_id', group.orderIds)
    createdBatches.push(batch)
  }

  await writeAudit(admin, {
    userId: caller.user_id,
    action: 'matching.run',
    entityType: 'consolidation_batches',
    after: {
      order_date,
      warehouse_code,
      eligible: result.eligible.length,
      excluded_over_max_sku: result.excludedOverMaxSku.length,
      groups_created: createdBatches.length,
      single_orders: result.singleOrders.length,
    },
  })

  return NextResponse.json({
    eligible_count: result.eligible.length,
    excluded_over_max_sku: result.excludedOverMaxSku.length,
    single_order_count: result.singleOrders.length,
    batches: createdBatches,
  })
}
