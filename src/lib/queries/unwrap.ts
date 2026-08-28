/**
 * `.data` on a Supabase response is `T[] | null` (null on error) — this always gives you an
 * array. Also logs the error instead of swallowing it: an RLS denial or bad query otherwise
 * looks identical to "genuinely no rows," which made a real bug (see getBatchDetail) very hard
 * to track down. Errors show up in Vercel's function logs.
 */
export function unwrap<T>(res: { data: T[] | null; error?: { message: string } | null }): T[] {
  if (res.error) {
    console.error('[supabase query error]', res.error.message)
  }
  return res.data ?? []
}
