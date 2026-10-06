/**
 * §6 Location Master — `locations.bin_code` (Location ID) is the plain, no-separator form WMS
 * itself uses, e.g. "A5J08A04" — this is the join/matching key used everywhere in this app (order
 * import, Pick Sheet/Pick Sequence sort, Location Master's own primary key) and never changes.
 *
 * Read cold, "A5J08A04" is hard to parse at a glance; the warehouse team reads it printed with two
 * dashes instead ("A5J-08-A04", Location Display) on every document a person actually reads (Pick
 * Slip's companion Pick Sheet, Consolidation Pick Report, Zone Dashboard, Short Pick Monitor, Admin
 * Verification, the weekly/short-pick exports, the Locations page itself). Rather than storing
 * this as a second column that could drift out of sync with bin_code, it's computed fresh from
 * bin_code every time it's displayed — the same "always derive it, never store a second copy"
 * principle this codebase already uses for pick_sequence (see pickSequence.ts).
 *
 * The split (Aisle+Side, 3 chars — Bay, 2 digits — Level+Block, 3 chars) was verified against
 * every one of 6,268 distinct real Bin Codes in a live WMS export (100% match, no exceptions)
 * before this was built. A bin_code that doesn't match this shape (an edge case not seen in that
 * data) is shown unchanged rather than mangled — never crashes, never shows garbled text, just
 * stays undashed until reviewed.
 */
const BIN_CODE_PATTERN = /^([A-Za-z]\d[A-Za-z])(\d{2})([A-Za-z]\d{2})$/

export function formatLocationDisplay(binCode: string): string {
  const m = BIN_CODE_PATTERN.exec(binCode)
  if (!m) return binCode
  return `${m[1]}-${m[2]}-${m[3]}`
}

/** Inverse of the above. A WMS export's own "Bin Code" column (both the order-import Transfer
 * List/Warehouse Pick Lines workbook and, defensively, a Location Master upload) may carry the
 * display dashes — `locations.bin_code` itself never does, so every write path strips them before
 * the value ever reaches the database, guaranteeing bin_code is always the canonical dash-free
 * Location ID regardless of which screen or file it arrived through. */
export function stripLocationDashes(binCode: string): string {
  return binCode.replace(/-/g, '')
}
