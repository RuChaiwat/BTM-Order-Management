/** Packing time bands (Configuration > Packing) -- client-safe, no server imports, so the Live
 * Packing Monitor and other browser components can colour timers the same way the server does. */
export interface PackTimeBands {
  /** yellow from this many minutes */
  yellowMinutes: number
  /** red from this many minutes (always > yellowMinutes) */
  redMinutes: number
}

export type PackTimeBand = 'green' | 'yellow' | 'red'

/** Which colour a pack timer of `minutes` shows. */
export function packTimeBand(minutes: number, bands: PackTimeBands): PackTimeBand {
  return minutes >= bands.redMinutes ? 'red' : minutes >= bands.yellowMinutes ? 'yellow' : 'green'
}
