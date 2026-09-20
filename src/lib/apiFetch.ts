type Listener = (busy: boolean) => void

let inFlight = 0
const listeners = new Set<Listener>()

function notify(busy: boolean) {
  for (const fn of listeners) fn(busy)
}

export function subscribeBusy(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/**
 * Drop-in replacement for fetch() to an internal /api/ route. Tracks how many requests are in
 * flight app-wide so a single <GlobalLoadingBar/> (mounted once in AppLayout) can show a top
 * progress bar and switch the cursor to "wait" — one place instead of every action button needing
 * its own spinner wiring. A button's own disabled/"Submitting…" state for the specific action it
 * triggered is unaffected by this; this is the passive, always-on layer underneath that.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  inFlight += 1
  if (inFlight === 1) notify(true)
  try {
    return await fetch(input, init)
  } finally {
    inFlight -= 1
    if (inFlight === 0) notify(false)
  }
}
