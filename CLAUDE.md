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

## Table column widths

Every data table (`className="table"`) with more than ~4 columns, or where one column holds
variable-length text (a name, order/SKU/item description, reason, filename, free-text detail)
alongside several short numeric/code/badge columns, must use a fixed layout instead of the
browser's auto column sizing:

```tsx
<table className="table" style={{ tableLayout: 'fixed', width: '100%' }}>
  <colgroup>
    <col style={{ width: '32%' }} />  {/* the text/name column gets the generous share */}
    <col style={{ width: '11%' }} />
    {/* ...one <col> per header, percentages summing to ~100% (or a literal px width for a
        genuinely fixed column like a checkbox) */}
  </colgroup>
  <thead>...</thead>
  ...
```

Give the identifying/text column(s) a generous width (roughly 25–45% depending on column count)
and tighten the short numeric/status columns around it — don't let auto-layout split the width
evenly, which starves the one column that actually needs room (a long picker name, order number,
or item description) while wasting space on columns that only ever hold a percentage or a 2-digit
count.

When a header label is wider than the data it heads (usually a 2+ word label like "ORDERS
COMPLETED" or "SHORT PICK RATE") and the column has been narrowed by the above, wrap the label
across two lines instead of letting it force the column wide:

```tsx
<th>ORDERS<br />COMPLETED</th>
```

(or, for a `SortHeader` component, widen its `label` prop type to `React.ReactNode` and pass a
`<>...<br />...</>` fragment — every local `SortHeader` in this codebase already supports this.)

Also add `style={{ overflowWrap: 'break-word' }}` to the `<td>` of any now-narrower text column
(names, zones lists, free-text reason/detail) so a single long word wraps inside its cell instead
of overflowing past the column's fixed width.

## General

- Thai subtitle under every page/card title (see `TopBar` usage and `card-subtitle` across
  existing pages) — every screen is bilingual, Thai first.
- `.btn` (`app/globals.css`) is defined with `display: inline-flex` + centering +
  `text-decoration: none` specifically so the class renders identically on `<button>`, `<a>`, and
  `<span>`. Don't remove that — before it was added, `.btn` relied on `<button>`'s own default box
  behavior, so any `<a>`/`<span>` styled with `.btn` (e.g. a Link-based Prev/Next, or a disabled
  state rendered as a `<span>`) lost vertical centering and anchors kept their underline. If you
  ever need one-off centering for a `.btn` element again, that's a sign `.btn` itself regressed —
  fix it there, not with a per-usage inline style.
- A `.card` that holds a table and is meant to grow/shrink with its flex parent should use
  `style={{ flex: 1 }}` only — never add `minHeight: 0` to a card or to a wrapper around a table
  unless you are certain the table's own content should be clipped and independently scrollable.
  `minHeight: 0` lets flexbox shrink the box below its content's natural height; if nothing inside
  clips that overflow, the content renders outside the visible card boundary instead of the card
  growing or the page scrolling. This caused two separate reported bugs on Location Master (the
  inner table wrapper and the outer card both had it) before being fixed and written up here.
