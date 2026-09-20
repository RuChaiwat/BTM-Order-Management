/** Next.js App Router shows this automatically while a route's Server Component (and everything
 * it awaits, including AppLayout's own session/badge-count queries) is still fetching — the "click
 * a menu item and nothing happens for a while" gap, since none of these pages had a loading.tsx
 * before. Being at the app root means it covers every route below it. */
export default function Loading() {
  return (
    <div className="page-loading-screen">
      <span className="spinner spinner-dark" />
      <span>กำลังโหลด… · Loading…</span>
    </div>
  )
}
