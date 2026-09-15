/**
 * Pages through a Supabase select using `.range()` until every row is read, instead of a single
 * `.limit(N)` — Supabase/PostgREST enforces a project-level "Max Rows" cap on every response that
 * a client-side `.limit()` can only ever LOWER, never raise (confirmed root cause of Zone Status,
 * the order-import Location Master lookup, and Order Pool overview all silently under-reporting
 * once real order volume passed that cap — see migrations 0012/0014). A single `.limit(200000)`
 * looks like it asks for enough rows, but the server still hands back only its own Max Rows worth
 * and stays silent about the rest.
 *
 * This works around that without needing to know the project's actual cap value: each call asks
 * for `pageSize` more rows starting at `from`, and advances `from` by however many rows actually
 * came back (not by `pageSize`) — so even if a single page itself gets capped below `pageSize`,
 * the next call picks up exactly where that page left off. Looping stops only once a call returns
 * zero rows, i.e. genuinely past the end of the data.
 */
export async function fetchAllRows<T>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = []
  let from = 0
  for (;;) {
    const { data, error } = await makeQuery(from, from + pageSize - 1)
    if (error) {
      console.error('[fetchAllRows] query error', error.message)
      break
    }
    const page = data ?? []
    if (page.length === 0) break
    all.push(...page)
    from += page.length
  }
  return all
}
