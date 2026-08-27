/** `.data` on a Supabase response is `T[] | null` (null on error) — this always gives you an array. */
export function unwrap<T>(res: { data: T[] | null }): T[] {
  return res.data ?? []
}
