import { TopBar } from '@/components/TopBar'
import { HandheldNav } from '@/components/handheld/HandheldNav'
import { PackHandheldBoard } from '@/components/packing/PackHandheldBoard'

/**
 * Pack Handheld -- deliberately public and unauthenticated, exactly like
 * /handheld/pick-completion: packers are rows in `pickers` with no login, so the device at a Pack
 * Station opens this URL directly (bookmark/kiosk shortcut) and each order starts by scanning the
 * Station, then the employee. Outside the (app) route group, so no Sidebar and no PC menus.
 * See /api/handheld/pack for the matching public API.
 */
export default function HandheldPackPage() {
  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar title="Packing" subtitle="บันทึกเวลาแพ็กสินค้า · Scan Station → รหัสพนักงาน → Order">
          <HandheldNav />
        </TopBar>
        <PackHandheldBoard />
      </div>
    </div>
  )
}
