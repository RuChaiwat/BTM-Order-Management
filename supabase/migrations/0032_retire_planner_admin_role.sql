-- Retires the 'planner_admin' role, merged into 'supervisor'.
--
-- Comparing every action-level permission check in the app (requireRole(...) calls across the API
-- routes), 'planner_admin' and 'supervisor' were already identical almost everywhere -- grouped
-- together in every requireRole() list for Matching, Admin Verification, Consolidation Batch
-- actions, Unassign Order, Picker scan-status, Order Import, and Work Assignment. The only real
-- differences: 'planner_admin' could Cancel Order (via /api/orders/[orderId]/cancel and its
-- companion /api/orders/lookup) while 'supervisor' could not, and 'supervisor' additionally had
-- Reason Master management, Picker Management, Configuration (view), and Audit Trail (view) that
-- 'planner_admin' never had. Having two roles that overlap this heavily just adds confusion with no
-- real separation of duties behind it (unlike 'warehouse_manager', which is genuinely a different,
-- non-operational role).
--
-- Merged as a union, not an intersection -- 'supervisor' picked up Cancel Order capability in the
-- application code (this migration doesn't touch that; see app/api/orders/[orderId]/cancel and
-- app/api/orders/lookup) rather than dropping it, so no existing 'planner_admin' user loses
-- anything by being moved to 'supervisor'.
--
-- The employees_users.role check constraint (migration 0001) and the various RLS policies
-- (migrations 0002, 0007) that list 'planner_admin' alongside other roles are deliberately left
-- alone here -- leaving an now-unused value in a CHECK constraint or an RLS policy's IN-list is
-- harmless (it simply never matches once no row has that role), and altering those is unnecessary
-- risk for zero behavioral change. Only the actual data is updated.
update employees_users
set role = 'supervisor'
where role = 'planner_admin';
