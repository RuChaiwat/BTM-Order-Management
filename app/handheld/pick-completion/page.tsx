import { TopBar } from '@/components/TopBar'
import { PickCompletionBoard } from '@/components/pickCompletion/PickCompletionBoard'

/**
 * Deliberately public, unauthenticated page for a Picker's own Handheld device -- no
 * getSessionUser()/redirect here at all (see app/api/handheld/picker-completions for the matching
 * public API and the reasoning: Pickers have no login of their own, migration 0015). Lives
 * outside the (app) route group entirely, so it never picks up that layout's auth requirement or
 * its Sidebar -- the Sidebar was exactly what made the screen cramped on a Handheld's small
 * display. Reuses .app-shell/.app-main (global CSS, not scoped to (app)) to get the same
 * full-height column layout minus the nav rail this needs no Sidebar to render at all.
 *
 * A device is set up ONCE to always open this exact URL (bookmark/kiosk shortcut) -- the same
 * "configure the device once" pattern as Work Assignment's Chrome --kiosk-printing shortcut.
 */
export default function HandheldPickCompletionPage() {
  return (
    <div className="app-shell">
      <div className="app-main">
        <TopBar title="Pick Completion" subtitle="ปิดงานหยิบของฉัน · สแกนรหัส Picker ของตัวเอง" />
        <PickCompletionBoard apiBase="/api/handheld/picker-completions" showReprint={false} />
      </div>
    </div>
  )
}
