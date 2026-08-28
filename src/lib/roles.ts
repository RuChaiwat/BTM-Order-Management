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

// id 8 = Pick Completion (picker's own field/PDA screen); id 16 = Admin Verification
// (office-only confirm/reject). Split from a single combined "Picker Monitor" menu item so the
// two audiences — floor pickers vs. office admins — don't share a screen (see requirement
// clarification: picker is at the work site, admin confirms in the office/WMS).
export const ROLE_MENU_ACCESS: Record<string, number[]> = {
  system_admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  warehouse_manager: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 14, 15, 16],
  supervisor: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16],
  planner_admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16],
  zone_controller: [1, 3, 8, 9, 10, 11, 12],
  picker: [1, 7, 8],
  viewer: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 16],
}

export function canAccessMenuItem(role: string, navItemId: number): boolean {
  return ROLE_MENU_ACCESS[role]?.includes(navItemId) ?? false
}
