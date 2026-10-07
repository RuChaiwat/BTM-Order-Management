# UI/UX standards for this project

These are standing rules for every screen in this app, confirmed with the client during UAT.
Any new page or component must follow them — don't hand-roll a one-off version of something
listed here.

## Pagination

Every paginated list uses the shared component from `src/components/Pagination.tsx`:

- `<Pagination page={page} totalPages={totalPages} onChange={setPage} />` for client-side state
  (list fetched once, paged in the browser).
- `<PaginationLinks page={page} totalPages={totalPages} hrefFor={pageHref} />` for server
  components that page via a `?page=` search param and a real `.range()` query (e.g. Location
  Master, where the table is too large to fetch in one request).

Layout is fixed: **Prev button — "Page X of Y" label — Next button**, in that order, right-aligned,
using `btn btn-secondary btn-sm` for the buttons. Do not put the label before the buttons, and do
not reimplement this footer locally even if it looks like it matches — two separate local copies
(`HousekeepingPanel.tsx`, `ZoneDashboardBoard.tsx`) silently drifted into the wrong label/button
order before this file existed, despite looking correct at a glance. If a page needs extra text
next to the page count (e.g. "· 12 batch(es)"), pass it via the `suffix` prop instead of writing a
new footer.

## Export to Excel

Every "export to Excel" action uses `<ExportExcelButton href={exportHref} />` from
`src/components/ExportExcelButton.tsx` — green (`btn-success`), with a download icon, label
"Export to Excel". Don't use `btn-secondary` or a plain text link for this action.

## General

- Thai subtitle under every page/card title (see `TopBar` usage and `card-subtitle` across
  existing pages) — every screen is bilingual, Thai first.
- A `.card` that holds a table and is meant to grow/shrink with its flex parent should use
  `style={{ flex: 1 }}` only — never add `minHeight: 0` to a card or to a wrapper around a table
  unless you are certain the table's own content should be clipped and independently scrollable.
  `minHeight: 0` lets flexbox shrink the box below its content's natural height; if nothing inside
  clips that overflow, the content renders outside the visible card boundary instead of the card
  growing or the page scrolling. This caused two separate reported bugs on Location Master (the
  inner table wrapper and the outer card both had it) before being fixed and written up here.
