/**
 * §10 Order Consolidation matching engine — pre-screen, P1-P4 clustering, batch split.
 *
 * The requirement deliberately leaves the clustering strategy to the implementation team
 * (§10 preamble: "may optimize candidate search strategy... business thresholds do not change
 * automatically"; §25: technical decomposition is the Programmer/AI Coding responsibility, not
 * fixed business logic). What IS fixed and implemented exactly as specified:
 *   - P1 = exact SKU-signature match, no pairwise comparison (FR-007).
 *   - Symmetric match % = |A ∩ B| / MAX(|A|, |B|) (§10.2).
 *   - An inverted SKU index limits candidate pairs to orders sharing ≥1 SKU, not all-to-all
 *     (FR-008, §10.1).
 *   - Priority thresholds and batch capacity are all read from configuration, never hardcoded.
 *
 * What's a judgment call (clustering orders into a P2-P4 GROUP, not just scoring a PAIR): greedy
 * seed-and-grow — take the largest unclustered order as a seed, add any candidate order whose
 * symmetric match against the seed clears that priority's threshold, until Maximum Stores/Orders
 * is hit. This is a reasonable, standard approach for this class of problem (true optimal
 * clustering is NP-hard) but not the only valid one — flagged rather than presented as the one
 * true algorithm the requirement mandates.
 */

export interface MatchableOrder {
  orderId: string
  storeCode: string
  uniqueSkuCount: number
  plannedPieces: number
  skus: string[]
}

export interface MatchingConfig {
  maxUniqueSku: number
  p1MinPieces: number
  p2MatchPct: number
  p2MinPieces: number
  p3MatchPct: number
  p3MinPieces: number
  p4MatchPct: number
  p4MinPieces: number
  minStores: number
  targetStores: number
  maxStores: number
  maxOrders: number | null
}

export type Priority = 'P1' | 'P2' | 'P3' | 'P4'

export interface MatchedGroup {
  priority: Priority
  orderIds: string[]
  storeCodes: string[]
  totalPieces: number
  uniqueSkuCount: number
  matchPct: number
}

export interface MatchingResult {
  eligible: MatchableOrder[]
  excludedOverMaxSku: string[]
  groups: MatchedGroup[]
  singleOrders: string[] // routed to P5 / Single Order — no qualifying group
}

function skuSignature(skus: string[]): string {
  return [...new Set(skus)].sort().join('|')
}

function symmetricMatchPct(a: Set<string>, b: Set<string>): number {
  let common = 0
  for (const sku of a) if (b.has(sku)) common++
  return common / Math.max(a.size, b.size)
}

function uniqueOrderCount(group: MatchableOrder[]): number {
  return new Set(group.flatMap((o) => o.skus)).size
}

export function runMatching(orders: MatchableOrder[], config: MatchingConfig): MatchingResult {
  const excludedOverMaxSku = orders.filter((o) => o.uniqueSkuCount > config.maxUniqueSku).map((o) => o.orderId)
  const eligible = orders.filter((o) => o.uniqueSkuCount <= config.maxUniqueSku && o.skus.length > 0)

  const groups: MatchedGroup[] = []
  const clustered = new Set<string>()

  // --- P1: exact SKU signature, no pairwise comparison (FR-007) ---
  const bySignature = new Map<string, MatchableOrder[]>()
  for (const o of eligible) {
    const sig = skuSignature(o.skus)
    if (!bySignature.has(sig)) bySignature.set(sig, [])
    bySignature.get(sig)!.push(o)
  }
  for (const group of bySignature.values()) {
    if (group.length < 2) continue
    const totalPieces = group.reduce((s, o) => s + o.plannedPieces, 0)
    if (totalPieces <= config.p1MinPieces) continue
    for (const o of group) clustered.add(o.orderId)
    groups.push({
      priority: 'P1',
      orderIds: group.map((o) => o.orderId),
      storeCodes: [...new Set(group.map((o) => o.storeCode))],
      totalPieces,
      uniqueSkuCount: uniqueOrderCount(group),
      matchPct: 1,
    })
  }

  // --- inverted index over remaining orders (FR-008, avoids all-to-all comparison) ---
  const remaining = eligible.filter((o) => !clustered.has(o.orderId))
  const skuIndex = new Map<string, Set<string>>() // sku -> order_ids
  for (const o of remaining) {
    for (const sku of o.skus) {
      if (!skuIndex.has(sku)) skuIndex.set(sku, new Set())
      skuIndex.get(sku)!.add(o.orderId)
    }
  }
  const byId = new Map(remaining.map((o) => [o.orderId, o]))

  function candidatesFor(order: MatchableOrder): MatchableOrder[] {
    const ids = new Set<string>()
    for (const sku of order.skus) {
      for (const id of skuIndex.get(sku) ?? []) {
        if (id !== order.orderId && !clustered.has(id)) ids.add(id)
      }
    }
    return [...ids].map((id) => byId.get(id)!).filter(Boolean)
  }

  const tiers: { priority: Priority; matchPct: number; minPieces: number }[] = [
    { priority: 'P2', matchPct: config.p2MatchPct, minPieces: config.p2MinPieces },
    { priority: 'P3', matchPct: config.p3MatchPct, minPieces: config.p3MinPieces },
    { priority: 'P4', matchPct: config.p4MatchPct, minPieces: config.p4MinPieces },
  ]

  // Largest orders first — a bigger seed's SKU set is a more stable basis for clustering.
  const seeds = remaining.slice().sort((a, b) => b.uniqueSkuCount - a.uniqueSkuCount)

  for (const tier of tiers) {
    for (const seed of seeds) {
      if (clustered.has(seed.orderId)) continue
      const seedSkus = new Set(seed.skus)
      const candidates = candidatesFor(seed)
        .map((c) => ({ order: c, pct: symmetricMatchPct(seedSkus, new Set(c.skus)) }))
        .filter((c) => c.pct >= tier.matchPct)
        .sort((a, b) => b.pct - a.pct)

      if (candidates.length === 0) continue

      const cluster: MatchableOrder[] = [seed]
      const storeCap = config.maxStores
      const orderCap = config.maxOrders ?? Infinity
      for (const { order } of candidates) {
        const wouldBeStores = new Set([...cluster.map((o) => o.storeCode), order.storeCode]).size
        if (wouldBeStores > storeCap) continue
        if (cluster.length + 1 > orderCap) break
        cluster.push(order)
      }

      const totalPieces = cluster.reduce((s, o) => s + o.plannedPieces, 0)
      const distinctStores = new Set(cluster.map((o) => o.storeCode)).size
      if (cluster.length < 2 || totalPieces <= tier.minPieces || distinctStores < config.minStores) continue

      const avgPct = candidates.filter((c) => cluster.includes(c.order)).reduce((s, c) => s + c.pct, 0) / Math.max(1, cluster.length - 1)
      for (const o of cluster) clustered.add(o.orderId)
      groups.push({
        priority: tier.priority,
        orderIds: cluster.map((o) => o.orderId),
        storeCodes: [...new Set(cluster.map((o) => o.storeCode))],
        totalPieces,
        uniqueSkuCount: uniqueOrderCount(cluster),
        matchPct: Math.round(avgPct * 1000) / 1000,
      })
    }
  }

  const singleOrders = eligible.filter((o) => !clustered.has(o.orderId)).map((o) => o.orderId)

  return { eligible, excludedOverMaxSku, groups, singleOrders }
}

/** §10.4 batch splitting — a cluster over Maximum Stores is chunked toward Target Stores,
 * balancing store count first (documented simplification: full piece-rebalancing across chunks
 * is not implemented — see module docstring). */
export function splitGroupIfNeeded(group: MatchedGroup, orders: MatchableOrder[], config: MatchingConfig): MatchedGroup[] {
  if (group.storeCodes.length <= config.maxStores) return [group]

  const byStore = new Map<string, MatchableOrder[]>()
  for (const id of group.orderIds) {
    const order = orders.find((o) => o.orderId === id)!
    if (!byStore.has(order.storeCode)) byStore.set(order.storeCode, [])
    byStore.get(order.storeCode)!.push(order)
  }
  const stores = [...byStore.keys()]
  const chunks: string[][] = []
  for (let i = 0; i < stores.length; i += config.targetStores) {
    chunks.push(stores.slice(i, i + config.targetStores))
  }

  return chunks.map((storeChunk) => {
    const chunkOrders = storeChunk.flatMap((s) => byStore.get(s)!)
    return {
      priority: group.priority,
      orderIds: chunkOrders.map((o) => o.orderId),
      storeCodes: storeChunk,
      totalPieces: chunkOrders.reduce((s, o) => s + o.plannedPieces, 0),
      uniqueSkuCount: uniqueOrderCount(chunkOrders),
      matchPct: group.matchPct,
    }
  })
}
