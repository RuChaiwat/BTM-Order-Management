import Link from 'next/link'

const WRAPPER_STYLE: React.CSSProperties = { display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 8, marginTop: 12, fontSize: 12 }
const LABEL_STYLE: React.CSSProperties = { color: 'var(--color-text-secondary)' }

/** Canonical pagination footer for this project -- Prev, "Page X of Y", Next, in that order, with
 * btn-secondary btn-sm buttons -- so every paginated list in the app renders identically. Every
 * other local reimplementation of this footer should be replaced with this component rather than
 * hand-rolled again. */
export function Pagination({ page, totalPages, onChange, suffix }: { page: number; totalPages: number; onChange: (page: number) => void; suffix?: React.ReactNode }) {
  return (
    <div style={WRAPPER_STYLE}>
      <button className="btn btn-secondary btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </button>
      <span style={LABEL_STYLE}>
        Page {page} of {totalPages}
        {suffix}
      </span>
      <button className="btn btn-secondary btn-sm" disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  )
}

/** Same footer for server components that page via ?page= search params + <Link> instead of client
 * state (e.g. Location Master, which pages a Postgres `.range()` query server-side). */
export function PaginationLinks({ page, totalPages, hrefFor }: { page: number; totalPages: number; hrefFor: (page: number) => string }) {
  return (
    <div style={WRAPPER_STYLE}>
      {page <= 1 ? (
        <span className="btn btn-secondary btn-sm" style={{ opacity: 0.5, pointerEvents: 'none' }}>
          Prev
        </span>
      ) : (
        <Link href={hrefFor(page - 1)} className="btn btn-secondary btn-sm">
          Prev
        </Link>
      )}
      <span style={LABEL_STYLE}>
        Page {page} of {totalPages}
      </span>
      {page >= totalPages ? (
        <span className="btn btn-secondary btn-sm" style={{ opacity: 0.5, pointerEvents: 'none' }}>
          Next
        </span>
      ) : (
        <Link href={hrefFor(page + 1)} className="btn btn-secondary btn-sm">
          Next
        </Link>
      )}
    </div>
  )
}
