import { redirect } from 'next/navigation'
import { canAccessMenuItem } from './roles'

/** Page-level enforcement of ROLE_MENU_ACCESS. The sidebar only HIDES menu items a role can't
 * access -- without this, typing the URL directly would still open the page. Call right after the
 * login check in every (app) page. Every role can reach the Operations Dashboard (id 1), so that's
 * where a blocked user is sent. */
export function requireMenuAccess(role: string, navItemId: number): void {
  if (!canAccessMenuItem(role, navItemId)) redirect('/dashboard')
}
