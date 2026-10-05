// Role -> visible nav item ids, and display labels.
//
// §7's permission table is coarse (module-group level: "Order Consolidation: View/approve" etc.)
// and doesn't give a per-menu-item breakdown for every role. This derives a reasonable
// per-menu mapping from combining §7's role/module table with §15's own "Primary Users" column
// per menu item — a judgment call where the requirement doesn't spell out the exact matrix,
// flagged here rather than silently guessed. Action-level permission (view vs. edit vs. approve)
// is enforced separately, per screen, via `requireRole` in the relevant Route Handler.

// 'picker' is intentionally not a key here any more -- Pickers no longer have a login (see
// migration 0015), so no employees_users row can ever have this role again. Left out of both maps
// rather than kept as permanently-dead entries; the label may still appear in old audit_logs/
// status_history snapshots, which display the raw string regardless of this map.
export const ROLE_LABELS: Record<string, string> = {
  system_admin: 'System Admin',
  warehouse_manager: 'Warehouse Manager',
  supervisor: 'Supervisor',
  planner_admin: 'Planner / Admin',
  zone_controller: 'Zone Controller',
  viewer: 'Viewer',
}

// id 8 = Pick Completion (kept as an office/supervisor-operated screen for completing on a
// picker's behalf, now that pickers themselves never log in); id 16 = Admin Verification
// (office-only confirm/reject); id 17 = Picker Management (Admin-only picker CRUD); id 18 =
// Audit Trail (split out of Configuration, id 15 -- same roles as 15 kept access to it, since it
// was simply a card on that same page before); id 19 = Short/Damage/Expired Monitor (same roles as
// 12, Productivity -- it's the other Analytics menu item); id 20 = Print & Reprint (same roles as
// 7/8, Work Assignment/Pick Completion -- the two screens whose documents it reprints).
export const ROLE_MENU_ACCESS: Record<string, number[]> = {
  system_admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20],
  warehouse_manager: [1, 2, 3, 4, 5, 6, 8, 9, 10, 11, 12, 14, 15, 16, 17, 18, 19, 20],
  supervisor: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 18, 19, 20],
  planner_admin: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 19, 20],
  zone_controller: [1, 3, 8, 9, 10, 11, 12, 19, 20],
  viewer: [1, 2, 3, 4, 5, 6, 9, 10, 11, 12, 16, 19],
}

export function canAccessMenuItem(role: string, navItemId: number): boolean {
  return ROLE_MENU_ACCESS[role]?.includes(navItemId) ?? false
}
