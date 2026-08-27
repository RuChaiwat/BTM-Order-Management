-- Row Level Security + derived views.
--
-- Architecture: RLS below governs SELECT (reads) for the browser client (anon/authenticated
-- key), scoped by role and zone/warehouse per §7's permission table. All WRITES (import,
-- matching/batching, assignment creation, picker completion, admin verification/cancel,
-- configuration changes) go through Next.js server route handlers using the service_role key,
-- which bypasses RLS — application code there checks the caller's role before writing. This is
-- deliberate, not an oversight: role/action permission (§7's "menu visibility and action
-- permission are separate") is enforced in application code where the business rules live,
-- while RLS provides defense-in-depth for reads and the FR-030 trigger (0001) enforces the
-- single-Zone/single-Warehouse rule at the DB layer regardless of which key writes.
--
-- This is a coarse-grained v1 (role + zone/warehouse scope). The full ADM/SUP/PLN/ZC/PCK/VW
-- per-module ●/◐/○ permission matrix from the Worker Management mockup is enforced at the
-- application/menu layer for now; a `role_permissions` table for fully data-driven parity with
-- that matrix is a reasonable follow-up, not built here.

-- ---------- auth helper functions (security definer to avoid RLS recursion) ----------

create or replace function auth_role() returns user_role as $$
  select role from employees_users where auth_user_id = auth.uid() and active limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function auth_business_user_id() returns text as $$
  select user_id from employees_users where auth_user_id = auth.uid() and active limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function auth_warehouse() returns text as $$
  select warehouse_code from employees_users where auth_user_id = auth.uid() and active limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function auth_zone_scope() returns text[] as $$
  select zone_scope from employees_users where auth_user_id = auth.uid() and active limit 1;
$$ language sql stable security definer set search_path = public;

create or replace function auth_is_zone_unscoped() returns boolean as $$
  select coalesce(array_length(auth_zone_scope(), 1), 0) = 0;
$$ language sql stable;

-- ---------- derived alert / backlog view (§13) ----------
-- Warning / Overdue / Critical / Backlog are conditions computed from status + elapsed time
-- against configuration thresholds, not stored statuses (see design note in 0001).

create or replace view order_alerts as
select
  o.order_id,
  o.status,
  o.assigned_time,
  o.picker_completed_time,
  extract(epoch from (coalesce(o.picker_completed_time, now()) - o.assigned_time)) / 60 as elapsed_minutes,
  case
    when o.status in ('assigned', 'in_progress') and o.assigned_time is not null then
      case
        when now() - o.assigned_time >= interval '120 minutes' then 'critical'
        when now() - o.assigned_time >= interval '60 minutes' then 'overdue'
        when now() - o.assigned_time >= interval '45 minutes' then 'warning'
        else null
      end
    else null
  end as time_alert,
  case when o.status in ('assigned', 'in_progress') and current_date > o.original_order_date
    then true else false end as is_picking_backlog,
  case when o.status in ('picker_completed_100', 'picker_completed_short')
    then true else false end as is_verification_backlog
from orders o;

comment on view order_alerts is
  'Derived Warning/Overdue/Critical/Backlog conditions per §13. Thresholds (45/60/120 min) are '
  'illustrative defaults matching the mockups — move to `configuration` (key=order_sla_minutes) '
  'before UAT; not yet wired to the configuration table in this migration.';

-- ---------- enable RLS ----------

alter table warehouses enable row level security;
alter table employees_users enable row level security;
alter table locations enable row level security;
alter table reason_master enable row level security;
alter table configuration enable row level security;
alter table import_batches enable row level security;
alter table import_errors enable row level security;
alter table orders enable row level security;
alter table order_lines enable row level security;
alter table consolidation_batches enable row level security;
alter table consolidation_orders enable row level security;
alter table assignment_batches enable row level security;
alter table assignment_orders enable row level security;
alter table picker_completions enable row level security;
alter table admin_verifications enable row level security;
alter table status_history enable row level security;
alter table audit_logs enable row level security;
alter table export_jobs enable row level security;
alter table purge_log enable row level security;

-- ---------- master / low-sensitivity data: any active employee may read ----------

-- Public (including anon/pre-login): the login screen's warehouse picker needs this list
-- before the user is authenticated. Warehouse codes/names are non-sensitive reference data.
create policy read_warehouses on warehouses for select using (true);
create policy read_locations on locations for select using (auth_role() is not null);
create policy read_reason_master on reason_master for select using (auth_role() is not null);
create policy read_configuration on configuration for select using (auth_role() is not null);

-- ---------- employees_users: self, or admin/manager/supervisor for the User Management screen ----------

create policy read_employees_users on employees_users for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor')
  or auth_user_id = auth.uid()
);

-- ---------- imports: admin / planner / supervisor ----------

create policy read_import_batches on import_batches for select using (
  auth_role() in ('system_admin', 'planner_admin', 'supervisor', 'warehouse_manager')
);
create policy read_import_errors on import_errors for select using (
  auth_role() in ('system_admin', 'planner_admin', 'supervisor', 'warehouse_manager')
);

-- ---------- orders / order_lines: role + zone/warehouse scoped ----------

create policy read_orders on orders for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
  or (
    auth_role() = 'zone_controller' and (
      auth_is_zone_unscoped()
      or exists (
        select 1 from order_lines ol
        where ol.order_id = orders.order_id and ol.zone_code = any(auth_zone_scope())
      )
    )
  )
  or (
    auth_role() = 'picker' and exists (
      select 1 from assignment_batches ab
      where ab.assignment_batch_id = orders.assignment_batch_id
        and ab.picker_id = auth_business_user_id()
    )
  )
);

create policy read_order_lines on order_lines for select using (
  exists (select 1 from orders o where o.order_id = order_lines.order_id)
  -- reuses the orders policy transitively via the FK read below is not automatic in Postgres RLS,
  -- so mirror the same predicate explicitly:
  and (
    auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
    or (auth_role() = 'zone_controller' and (auth_is_zone_unscoped() or order_lines.zone_code = any(auth_zone_scope())))
    or (auth_role() = 'picker' and exists (
      select 1 from assignment_batches ab
      join orders o2 on o2.assignment_batch_id = ab.assignment_batch_id
      where o2.order_id = order_lines.order_id and ab.picker_id = auth_business_user_id()
    ))
  )
);

-- ---------- consolidation ----------

create policy read_consolidation_batches on consolidation_batches for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
);
create policy read_consolidation_orders on consolidation_orders for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
);

-- ---------- assignment ----------

create policy read_assignment_batches on assignment_batches for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin')
  or (auth_role() = 'zone_controller' and (auth_is_zone_unscoped() or assignment_batches.zone_code = any(auth_zone_scope())))
  or (auth_role() = 'picker' and assignment_batches.picker_id = auth_business_user_id())
);
create policy read_assignment_orders on assignment_orders for select using (
  exists (
    select 1 from assignment_batches ab where ab.assignment_batch_id = assignment_orders.assignment_batch_id
    and (
      auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin')
      or (auth_role() = 'zone_controller' and (auth_is_zone_unscoped() or ab.zone_code = any(auth_zone_scope())))
      or (auth_role() = 'picker' and ab.picker_id = auth_business_user_id())
    )
  )
);

-- ---------- completion / verification ----------

create policy read_picker_completions on picker_completions for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
  or exists (
    select 1 from orders o join assignment_batches ab on ab.assignment_batch_id = o.assignment_batch_id
    where o.order_id = picker_completions.order_id and ab.picker_id = auth_business_user_id()
  )
);
create policy read_admin_verifications on admin_verifications for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
);

-- ---------- audit / exports: admin + manager only ----------

create policy read_status_history on status_history for select using (
  auth_role() in ('system_admin', 'warehouse_manager')
);
create policy read_audit_logs on audit_logs for select using (
  auth_role() in ('system_admin', 'warehouse_manager')
);
create policy read_export_jobs on export_jobs for select using (
  auth_role() in ('system_admin', 'warehouse_manager')
);
create policy read_purge_log on purge_log for select using (
  auth_role() in ('system_admin', 'warehouse_manager')
);

-- No INSERT/UPDATE/DELETE policies are defined for the `authenticated` role on any table above.
-- RLS defaults to deny, so all writes are only possible via the service_role key (server routes),
-- where application code performs the FR-007/007-033 business-rule checks before writing.
