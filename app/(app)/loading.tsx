/** Next.js shows this automatically in the (app) layout's {children} slot while a page's own
 * Server Component is still fetching data -- the layout itself (Sidebar, GlobalLoadingBar) is a
 * persistent ancestor and is NOT part of what this replaces, so the sidebar stays mounted and
 * responsive (its active-item highlight already updates instantly on click, via usePathname())
 * instead of the whole screen going blank on every navigation. */
export default function Loading() {
  return (
    <div className="page-loading-screen">
      <span className="spinner spinner-dark" />
      <span>กำลังโหลด… · Loading…</span>
    </div>
  )
}
