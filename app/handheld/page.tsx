import Link from 'next/link'
import { TopBar } from '@/components/TopBar'

/**
 * Handheld menu -- the one URL every Handheld device opens (bookmark/kiosk shortcut). Devices are
 * shared, so each user picks Pick or Pack here. Public like the rest of /handheld (see
 * src/lib/supabase/middleware.ts); no role check -- anyone in Picker & Packer Management can do
 * either job, and each screen still needs its own scans (Pick: the order sheet, Pack: the Station
 * barcode). The old direct URLs (/handheld/pick-completion, /handheld/pack) keep working.
 */
export default function HandheldMenuPage() {
  const tile: React.CSSProperties = {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 150,
    borderRadius: 14,
    textDecoration: 'none',
    color: '#fff',
    fontWeight: 700,
  }
  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar title="BTM Handheld" subtitle="เลือกงานที่จะทำ · Choose your job" />
        <div className="page-body" style={{ maxWidth: 640, width: '100%', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
          <Link href="/handheld/pick-completion" style={{ ...tile, background: 'var(--color-info, #2563EB)' }}>
            <span style={{ fontSize: 34 }}>Pick</span>
            <span style={{ fontSize: 15, fontWeight: 500 }}>ปิดงานหยิบสินค้า · Pick Completion</span>
          </Link>
          <Link href="/handheld/pack" style={{ ...tile, background: 'var(--color-success, #16A34A)' }}>
            <span style={{ fontSize: 34 }}>Pack</span>
            <span style={{ fontSize: 15, fontWeight: 500 }}>จับเวลาแพ็กสินค้า · Packing</span>
          </Link>
        </div>
      </div>
    </div>
  )
}
