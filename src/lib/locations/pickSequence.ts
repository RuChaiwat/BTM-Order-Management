/**
 * §6 Location Master — Pick Sequence formula, implementing the stated business rule directly
 * (numeric, sortable, ordered Aisle → Side Pair → Bay → Direction → Level → Block; e.g. Aisle A1
 * = "01", Side Pair AB = "01", Bay 01 = "01", Right = "1"/Left = "2", Level A = "01", Block 01 =
 * "01"). The real Location_Master_with_Pick_Sequence file's own pre-computed Pick Sequence column
 * does not reliably follow this — spot-checking it turned up inconsistent Bay/Direction encoding
 * once Bay goes past ~4 in a given Aisle/Side (values repeat instead of continuing to increase),
 * so that column is NOT imported or trusted. Pick Sequence is always computed fresh from the
 * structured fields via this module, both on bulk import and when adding a single Location.
 *
 * Pure and isomorphic on purpose (no DB access) — safe to import from a client component for a
 * live preview as well as from a server route for the authoritative value.
 *
 * Side Pair / Direction / Level are pure functions of a single letter, so they never need a
 * lookup table: side pairs run AB, CD, EF, ... consecutively from 'A' (the first letter of a pair
 * is always Right, the second Left), and Levels run A, B, C, ... Aisle is the only component that
 * needs an externally-maintained rank (see src/lib/locations/aisleRank.ts) because Aisle codes
 * (A1, A6, B1, R2, ...) don't have a universally deterministic order.
 */

export function sidePairIndex(side: string): number {
  const offset = side.trim().toUpperCase().charCodeAt(0) - 65 // 'A' = 0
  return Math.floor(offset / 2) + 1
}

export function sidePairCode(side: string): string {
  const idx = sidePairIndex(side) // 1-based
  const firstLetterCode = 65 + (idx - 1) * 2
  return `${String.fromCharCode(firstLetterCode)}${String.fromCharCode(firstLetterCode + 1)}`
}

export function directionForSide(side: string): 'RIGHT' | 'LEFT' {
  const offset = side.trim().toUpperCase().charCodeAt(0) - 65
  return offset % 2 === 0 ? 'RIGHT' : 'LEFT'
}

export function levelIndex(level: string): number {
  return level.trim().toUpperCase().charCodeAt(0) - 64 // 'A' = 1
}

function pad2(value: string | number): string {
  return String(value).padStart(2, '0')
}

export interface PickSequenceInput {
  aisleRank: number
  side: string
  bay: string | number
  level: string
  block: string | number
}

/**
 * Every segment is fixed-width and zero-padded, Aisle included — pick_sequence is a `text`
 * column, sorted lexicographically (`order('pick_sequence')`), and an unpadded Aisle rank breaks
 * that sort as soon as there are 10+ aisles: the string "10..." sorts before "2..." because '1' <
 * '2' as a character. Padding to 2 digits (supports up to 99 aisles) fixes that and matches the
 * business rule's own example format (Aisle A1 -> "01").
 */
export function computePickSequence({ aisleRank, side, bay, level, block }: PickSequenceInput): string {
  const direction = directionForSide(side) === 'RIGHT' ? '1' : '2'
  return `${pad2(aisleRank)}${pad2(sidePairIndex(side))}${pad2(bay)}${direction}${pad2(levelIndex(level))}${pad2(block)}`
}
