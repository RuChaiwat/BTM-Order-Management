import { redirect } from 'next/navigation'
import { canAccessMenuItem, homePathForRole } from './roles'

/** Page-level enforcement of ROLE_MENU_ACCESS. The sidebar only HIDES menu items a role can't
 * access -- without this, typing the URL directly would still open the page. Call right after the
 * login check in every (app) page. A blocked user is sent to their role's own landing page --
 * /dashboard for every role except Supervisor (Pack), which can't open it. */
export function requireMenuAccess(role: string, navItemId: number): void {
  if (!canAccessMenuItem(role, navItemId)) redirect(homePathForRole(role))
}
