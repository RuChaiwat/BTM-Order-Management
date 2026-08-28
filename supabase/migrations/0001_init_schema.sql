-- Beautrium OMS — initial schema, per Requirement v1.2 §21 (Data Model & Key Relationships)
-- and the field/status definitions in §5, §6, §12, §13, Appendix A, Appendix B.
--
-- Design notes / judgment calls made where the requirement is silent on implementation detail:
--
-- 1. Status modeling (Appendix B lists "Warning / Overdue / Critical" and "Picking Backlog /
--    Verification Backlog" as statuses, alongside lifecycle statuses like Assigned/In Progress).
--    Treating all of those as one mutually-exclusive enum would combinatorially explode
--    (an order can be simultaneously "In Progress" AND "Overdue"). Instead: `orders.status`
--    holds the lifecycle state only; Warning/Overdue/Critical/Backlog are DERIVED — computed
--    from status + elapsed time against `configuration` thresholds — exposed via the
--    `order_alerts` view (0002). This keeps the state machine clean and matches §13's own
--    framing of these as "threshold reached" conditions, not terminal states.
--
-- 2. Multi-zone orders vs. single-zone Assignment Batches (FR-030): an order's lines can touch
--    multiple zones (§12 "An Order may touch one or more Zones"), but v1.2 confines each
--    Assignment Batch to one Zone + one Warehouse. The requirement does not specify how a
--    multi-zone order's lines are picked across zones. This schema takes the simplest
--    interpretation consistent with the mockups (which assign whole orders, not partial
--    orders): an order is ELIGIBLE for a Zone/Warehouse assignment batch if at least one of
--    its lines is in that zone+warehouse, and assignment is at the whole-order grain — the
--    same order-level assignment model already built in the UI. This is a simplifying
--    assumption, not stated in the requirement; flagged here for business confirmation
--    (candidate addition to Appendix D).

create extension if not exists pgcrypto;

-- ---------- enums ----------

create type user_role as enum (
  'system_admin', 'warehouse_manager', 'supervisor', 'planner_admin',
  'zone_controller', 'picker', 'viewer'
);

create type order_status as enum (
  'new', 'assigned', 'in_progress',
  'picker_completed_100', 'picker_completed_short',
  'waiting_admin_verification', 'admin_rejected', 'correction_in_progress',
  'final_closed_100', 'final_closed_short',
  'cancelled'
);

create type consolidation_batch_status as enum (
  'candidate', 'review', 'approved', 'report_released',
  'picking', 'at_consolidation', 'sorting', 'completed', 'cancelled'
);

create type assignment_batch_status as enum (
  'draft', 'assigned', 'in_progress', 'completed', 'over_capacity_override', 'cancelled'
);

create type assignment_method as enum ('list_selection', 'barcode_scan');

create type import_status as enum ('uploaded', 'validating', 'completed', 'completed_with_errors', 'failed');

create type reason_type as enum ('short_pick', 'cancel');

create type matching_priority as enum ('P1', 'P2', 'P3', 'P4');

create type export_job_type as enum ('weekly_productivity_export', 'purge');
create type export_job_status as enum ('pending', 'running', 'success', 'failed');

-- ---------- shared / master data ----------

create table warehouses (
  warehouse_code text primary key,
  name text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table employees_users (
  user_id text primary key,                          -- business user id, e.g. U0001 / P002
  auth_user_id uuid unique references auth.users(id) on delete set null,
  employee_id text,
  name_en text not null,
  name_th text,
  email text unique,
  role user_role not null,
  warehouse_code text references warehouses(warehouse_code),
  zone_scope text[] not null default '{}',            -- zones this user is scoped to (empty = all)
  active boolean not null default true,
  shift_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_employees_users_auth on employees_users(auth_user_id);

create table locations (
  bin_code text not null,
  warehouse_code text not null references warehouses(warehouse_code),
  zone_code text not null,
  zone_name text,
  aisle text,
  side text,
  side_pair text,
  direction text check (direction in ('RIGHT', 'LEFT')),
  bay text,
  level text,
  block text,
  pick_sequence text,                                  -- composite sortable key, per §6
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (warehouse_code, bin_code)
);
create index idx_locations_zone on locations(warehouse_code, zone_code);
create index idx_locations_pick_sequence on locations(pick_sequence);

create table reason_master (
  reason_code text primary key,
  reason_type reason_type not null,
  label_en text not null,
  label_th text,
  active boolean not null default true,
  created_by text references employees_users(user_id),
  updated_by text references employees_users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Effective-dated configuration store (§17 governance): changes apply only to new
-- batches/orders after activation; in-progress entities keep the config version at creation.
create table configuration (
  id uuid primary key default gen_random_uuid(),
  key text not null,
  value jsonb not null,
  scope text not null default 'global',                -- e.g. warehouse_code, or 'global'
  effective_date date not null default current_date,
  version int not null default 1,
  active boolean not null default true,
  changed_by text references employees_users(user_id),
  changed_at timestamptz not null default now(),
  change_reason text
);
create index idx_configuration_key_active on configuration(key, scope) where active;
create unique index uq_configuration_key_scope_version on configuration(key, scope, version);

-- ---------- order core (§5, §21) ----------

create table import_batches (
  import_id uuid primary key default gen_random_uuid(),
  file_name text not null,
  uploaded_by text references employees_users(user_id),
  uploaded_at timestamptz not null default now(),
  status import_status not null default 'uploaded',
  total_rows int not null default 0,
  success_rows int not null default 0,
  error_rows int not null default 0,
  finished_at timestamptz
);

create table import_errors (
  error_id uuid primary key default gen_random_uuid(),
  import_id uuid not null references import_batches(import_id) on delete cascade,
  row_number int not null,
  raw_data jsonb not null,
  error_reason text not null,
  created_at timestamptz not null default now()
);
create index idx_import_errors_import on import_errors(import_id);

create table orders (
  order_id uuid primary key default gen_random_uuid(),
  order_no text not null,
  warehouse_code text not null references warehouses(warehouse_code),
  original_order_date date not null,                   -- WMS "Shipment Date"
  store_code text not null,
  planned_pieces int not null default 0,
  unique_sku_count int not null default 0,
  status order_status not null default 'new',
  import_id uuid references import_batches(import_id),
  consolidation_batch_id uuid,                          -- FK added after consolidation_batches exists
  assignment_batch_id uuid,                              -- FK added after assignment_batches exists
  assigned_time timestamptz,
  picker_completed_time timestamptz,
  cancelled_by text references employees_users(user_id),
  cancelled_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (warehouse_code, order_no, original_order_date)
);
create index idx_orders_status on orders(status);
create index idx_orders_date on orders(original_order_date);
create index idx_orders_warehouse on orders(warehouse_code);
create index idx_orders_assignment_batch on orders(assignment_batch_id);
create index idx_orders_consolidation_batch on orders(consolidation_batch_id);

create table order_lines (
  line_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(order_id) on delete cascade,
  sku text not null,
  bin_code text not null,
  warehouse_code text not null references warehouses(warehouse_code),
  qty numeric not null check (qty > 0),
  uom_code text default 'PCS',
  item_description text,
  source_line_id text,                                  -- WMS source line identifier, where available
  zone_code text,                                        -- denormalized from locations at import time
  pick_sequence text,                                     -- denormalized from locations at import time
  created_at timestamptz not null default now(),
  unique (order_id, sku, bin_code, source_line_id)
);
create index idx_order_lines_order on order_lines(order_id);
create index idx_order_lines_bin on order_lines(warehouse_code, bin_code);
create index idx_order_lines_sku on order_lines(sku);
create index idx_order_lines_zone on order_lines(zone_code);

-- ---------- order consolidation (§9-11) ----------

create table consolidation_batches (
  consol_batch_id uuid primary key default gen_random_uuid(),
  order_date date not null,
  priority matching_priority not null,
  match_pct numeric,
  stores_count int not null default 0,
  orders_count int not null default 0,
  unique_sku_count int not null default 0,
  total_pieces int not null default 0,
  config_version int,
  status consolidation_batch_status not null default 'candidate',
  created_by text references employees_users(user_id),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  report_generated_at timestamptz
);
create index idx_consolidation_batches_date on consolidation_batches(order_date);
create index idx_consolidation_batches_status on consolidation_batches(status);

create table consolidation_orders (
  consol_batch_id uuid not null references consolidation_batches(consol_batch_id) on delete cascade,
  order_id uuid not null references orders(order_id),
  sequence int,
  primary key (consol_batch_id, order_id)
);

alter table orders
  add constraint fk_orders_consolidation_batch
  foreign key (consolidation_batch_id) references consolidation_batches(consol_batch_id);

-- ---------- order picking productivity: assignment (§12) ----------

create table assignment_batches (
  assignment_batch_id uuid primary key default gen_random_uuid(),
  warehouse_code text not null references warehouses(warehouse_code),
  zone_code text not null,                              -- FR-030: batch is confined to ONE zone
  picker_id text references employees_users(user_id),
  admin_id text references employees_users(user_id),
  assigned_time timestamptz,                             -- set only on Admin confirm (§12.1)
  planned_pieces int not null default 0,
  workload_status text,                                  -- low / target / acceptable_over / over
  assignment_method assignment_method not null,
  config_version int,
  status assignment_batch_status not null default 'draft',
  linked_consolidation_batch_id uuid references consolidation_batches(consol_batch_id),
  created_at timestamptz not null default now()
);
create index idx_assignment_batches_zone on assignment_batches(warehouse_code, zone_code);
create index idx_assignment_batches_picker on assignment_batches(picker_id);

create table assignment_orders (
  assignment_batch_id uuid not null references assignment_batches(assignment_batch_id) on delete cascade,
  order_id uuid not null references orders(order_id),
  sequence int,
  source_type text,                                      -- 'consolidation' | 'single' | 'backlog'
  source_id uuid,
  primary key (assignment_batch_id, order_id)
);

alter table orders
  add constraint fk_orders_assignment_batch
  foreign key (assignment_batch_id) references assignment_batches(assignment_batch_id);

-- FR-030 / UAT-19: enforce single-Zone + single-Warehouse confinement at the transaction layer,
-- not UI-only (§23). An order is eligible for a batch's zone if ANY of its lines are in that
-- zone+warehouse (see design note #2 above on multi-zone orders).
create or replace function enforce_assignment_zone_warehouse()
returns trigger as $$
declare
  batch_zone text;
  batch_warehouse text;
  order_status_val order_status;
  line_match_count int;
begin
  select zone_code, warehouse_code into batch_zone, batch_warehouse
  from assignment_batches where assignment_batch_id = new.assignment_batch_id;

  select status into order_status_val from orders where order_id = new.order_id;
  if order_status_val = 'cancelled' then
    raise exception 'Order % is Cancelled and cannot be Assigned (FR-029)', new.order_id;
  end if;

  select count(*) into line_match_count
  from order_lines
  where order_id = new.order_id
    and zone_code = batch_zone
    and warehouse_code = batch_warehouse;

  if line_match_count = 0 then
    raise exception 'Order % has no lines in Zone % / Warehouse % — Assignment Batch must be confined to a single Zone and Warehouse (FR-030)',
      new.order_id, batch_zone, batch_warehouse;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_enforce_assignment_zone_warehouse
  before insert on assignment_orders
  for each row execute function enforce_assignment_zone_warehouse();

-- ---------- picker completion & admin verification (§12.2, §12.3) ----------

create table picker_completions (
  completion_id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references orders(order_id),
  picker_completed_time timestamptz not null default now(),
  actual_pieces int not null,
  result text not null check (result in ('100_percent', 'short')),
  short_reason_code text references reason_master(reason_code),
  remark text,
  created_at timestamptz not null default now()
);

create table admin_verifications (
  verification_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(order_id),
  admin_id text references employees_users(user_id),
  decision text not null check (decision in ('final_close', 'reject')),
  verified_time timestamptz not null default now(),
  reject_reason text,
  created_at timestamptz not null default now()
);
create index idx_admin_verifications_order on admin_verifications(order_id);

-- ---------- audit / history (§23) ----------

create table status_history (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null,
  entity_id text not null, -- uuid for orders/batches, or a business key like 'U0001' for employees_users
  old_status text,
  new_status text not null,
  changed_by text references employees_users(user_id),
  changed_at timestamptz not null default now(),
  reason text
);
create index idx_status_history_entity on status_history(entity_type, entity_id);

create table audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id text references employees_users(user_id),
  action text not null,
  entity_type text not null,
  entity_id text, -- uuid for orders/batches, or a business key like 'U0001'/'DAMAGED' for employees_users/reason_master
  before jsonb,
  after jsonb,
  created_at timestamptz not null default now()
);
create index idx_audit_logs_entity on audit_logs(entity_type, entity_id);
create index idx_audit_logs_created_at on audit_logs(created_at);

-- ---------- exports / housekeeping (§20) ----------

create table export_jobs (
  id uuid primary key default gen_random_uuid(),
  job_type export_job_type not null,
  status export_job_status not null default 'pending',
  period_start date,
  period_end date,
  row_count int,
  control_totals jsonb,
  target_ref text,                                       -- e.g. Google Sheets file name/URL
  started_at timestamptz,
  finished_at timestamptz,
  error_detail text,
  triggered_by text references employees_users(user_id),
  created_at timestamptz not null default now()
);
create index idx_export_jobs_type_status on export_jobs(job_type, status);

create table purge_log (
  id uuid primary key default gen_random_uuid(),
  export_job_id uuid references export_jobs(id),
  purge_date date not null default current_date,
  covered_period_start date not null,
  covered_period_end date not null,
  table_name text not null,
  rows_purged int not null default 0,
  executed_by text default 'system',
  result text not null check (result in ('success', 'failed')),
  created_at timestamptz not null default now()
);
