/** Canonical "Export to Excel" button for this project -- green (btn-success) with a download
 * icon, so every export control in the app renders identically. */
export function ExportExcelButton({ href, style }: { href: string; style?: React.CSSProperties }) {
  return (
    <a className="btn btn-success btn-sm" style={style} href={href} download>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 3v12m0 0l-4-4m4 4l4-4" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M4 17v2a2 2 0 002 2h12a2 2 0 002-2v-2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      Export to Excel
    </a>
  )
}
