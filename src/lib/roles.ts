// Role -> visible nav item ids, and display labels.
//
// §7's permission table is coarse (module-group level: "Order Consolidation: View/approve" etc.)
// and doesn't give a per-menu-item breakdown for every role. This derives a reasonable
// per-menu mapping from combining §7's role/module table with §15's own "Primary Users" column
// per menu item — a judgment call where the requirement doesn't spell out the exact matrix,
// flagged here rather than silently guessed. Action-level permission (view vs. edit vs. approve)
// is enforced separately, per screen, via `requireRole` in the relevant Route Handler.

export const ROLE_LABELS: Record<string, string> = {
  system_admin: 'System Admin',
  warehouse_manager: 'Warehouse Manager',
  supervisor: 'Supervisor',
  planner_admin: 'Planner / Admin',
  zone_controller: 'Zone Controller',
  picker: 'Picker',
  viewer: 'Viewer',
}

export const ROLE_MENU_ACCESS: Record<string, number[]> = {
  system_admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  warehouse_manager: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15],
  supervisor: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15],
  planner_admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
  zone_controller: [1, 3, 8, 9, 10, 11, 12],
  picker: [1, 7, 8],
  viewer: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12],
}

export function canAccessMenuItem(role: string, navItemId: number): boolean {
  return ROLE_MENU_ACCESS[role]?.includes(navItemId) ?? false
}
