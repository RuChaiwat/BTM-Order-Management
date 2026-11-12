-- Packing module, phase 1 (2026-11 client request).
--
-- After Admin Verification Final Closes an order (status final_closed_100 / final_closed_short),
-- the Pack team scans it at a Pack Station: scan #1 starts the timer, scan #2 of the same order
-- stops it with Completed or Completed with Short (the latter itemizes the problem lines). A
-- Pack Supervisor then confirms the pack (after doing it in WMS) on Admin Pack Verify.
--
-- Design notes:
--   * Packing state lives in its OWN column, orders.pack_status, instead of new order_status enum
--     values -- every Pick/Consolidation screen, dashboard and SQL view reads orders.status, and
--     keeping that column untouched means none of them change. pack_status is NULL for every
--     order that never entered packing.
--   * Go-live = when this migration runs: existing final_closed orders are deliberately NOT
--     backfilled into the pack queue (they were packed outside this system already); only orders
--     Final Closed from now on get pack_status = 'pending' (set by /api/admin-verifications).
--   * Packers are the same people as Pickers -- no new staff table; pack_sessions.picker_id
--     references pickers(picker_id). Productivity tells Pick work from Pack work by source table.
--   * Pack issue reasons get their own small master table (same pattern as
--     picker_employment_types, 0033) rather than a new reason_master.reason_type enum value: a new
--     enum value can't be used in the same transaction that adds it, so the seed rows below would
--     fail, and the Pack Supervisor maintains this list separately from the Pick-side reasons.
--   * Every order_id FK cascades on delete so the retention purge (app/api/cron/purge), which
--     deletes old orders, keeps working without having to know about these tables.

-- New login role for the Pack-side supervisor (shown as "Supervisor (Pack)"). Not used anywhere
-- else in this migration (a new enum value can't be referenced in the transaction that adds it).
alter type user_role add value if not exists 'pack_supervisor';

-- ---------- master data ----------

create table pack_stations (
  station_code text primary key check (char_length(station_code) between 1 and 20),
  name text not null,
  warehouse_code text references warehouses(warehouse_code),
  active boolean not null default true,
  created_by text references employees_users(user_id),
  updated_by text references employees_users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table pack_issue_reasons (
  reason_code text primary key,
  label_en text not null,
  label_th text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_by text references employees_users(user_id),
  updated_by text references employees_users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into pack_issue_reasons (reason_code, label_en, label_th, sort_order) values
  ('SHORT', 'Item short', 'สินค้าขาด', 10),
  ('OVER', 'Item over', 'สินค้าเกิน', 20),
  ('DAMAGED', 'Damaged item', 'สินค้าเสียหาย', 30),
  ('BARCODE_SWAP', 'Barcode swapped', 'สินค้าสลับบาร์', 40),
  ('NOT_IN_TO', 'Item not in TO', 'สินค้าไม่มีใน TO', 50),
  ('EXPIRED', 'Expired item', 'สินค้าหมดอายุ', 60);

-- ---------- order pack state ----------

alter table orders
  add column pack_status text check (pack_status in ('pending', 'packing', 'packed', 'issue', 'confirmed')),
  add column pack_ready_at timestamptz;   -- when the order entered the pack queue (Final Close time)
create index idx_orders_pack_status on orders(warehouse_code, pack_status) where pack_status is not null;

-- ---------- pack transactions ----------

-- One row per scan-to-scan packing attempt. finished_at IS NULL = currently being packed.
create table pack_sessions (
  session_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(order_id) on delete cascade,
  picker_id text not null references pickers(picker_id),
  station_code text not null references pack_stations(station_code),
  warehouse_code text references warehouses(warehouse_code),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  result text check (result in ('completed', 'completed_short', 'cancelled')),
  pieces int not null default 0,          -- order's verified pieces when packing started
  issue_pieces int not null default 0,    -- pieces reported as a problem (excluded from productivity)
  cancelled_by text references employees_users(user_id),
  cancel_reason text,
  created_at timestamptz not null default now()
);
-- At most one open session per order, and per packer -- enforced here, not just in the API, so
-- two scanners racing on the same order can't both start it.
create unique index uq_pack_sessions_open_order on pack_sessions(order_id) where finished_at is null;
create unique index uq_pack_sessions_open_picker on pack_sessions(picker_id) where finished_at is null;
create index idx_pack_sessions_started on pack_sessions(started_at);
create index idx_pack_sessions_picker on pack_sessions(picker_id, started_at);
create index idx_pack_sessions_order on pack_sessions(order_id);

-- A problem report raised by Completed with Short. Investigated on the Pack Issue screen (phase 3).
create table pack_issues (
  issue_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(order_id) on delete cascade,
  session_id uuid references pack_sessions(session_id) on delete cascade,
  picker_id text references pickers(picker_id),          -- the packer who reported it
  station_code text references pack_stations(station_code),
  warehouse_code text references warehouses(warehouse_code),
  remark text,
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved')),
  reported_at timestamptz not null default now(),
  acknowledged_by text references employees_users(user_id),
  acknowledged_at timestamptz,
  root_cause text,
  resolution text check (resolution in ('closed_by_admin', 'returned_to_pack')),
  resolution_note text,
  resolved_by text references employees_users(user_id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index idx_pack_issues_status on pack_issues(warehouse_code, status);
create index idx_pack_issues_reported on pack_issues(reported_at);
create index idx_pack_issues_order on pack_issues(order_id);

-- One row per problem item. line_id is NULL for an item that isn't on the order at all
-- ("Item not in TO") -- then sku holds whatever the packer scanned/typed.
create table pack_issue_lines (
  id uuid primary key default gen_random_uuid(),
  issue_id uuid not null references pack_issues(issue_id) on delete cascade,
  line_id uuid references order_lines(line_id) on delete set null,
  sku text not null,
  item_description text,
  bin_code text,
  reason_code text not null references pack_issue_reasons(reason_code),
  qty int not null check (qty > 0),
  created_at timestamptz not null default now()
);
create index idx_pack_issue_lines_issue on pack_issue_lines(issue_id);

create table pack_verifications (
  verification_id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(order_id) on delete cascade,
  admin_id text references employees_users(user_id),
  verified_time timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index idx_pack_verifications_order on pack_verifications(order_id);

-- Same "any signed-in role can read; writes go through the service-role client in the API routes"
-- pattern as every other admin-managed table (0002/0015/0033).
alter table pack_stations enable row level security;
alter table pack_issue_reasons enable row level security;
alter table pack_sessions enable row level security;
alter table pack_issues enable row level security;
alter table pack_issue_lines enable row level security;
alter table pack_verifications enable row level security;
create policy read_pack_stations on pack_stations for select using (auth_role() is not null);
create policy read_pack_issue_reasons on pack_issue_reasons for select using (auth_role() is not null);
create policy read_pack_sessions on pack_sessions for select using (auth_role() is not null);
create policy read_pack_issues on pack_issues for select using (auth_role() is not null);
create policy read_pack_issue_lines on pack_issue_lines for select using (auth_role() is not null);
create policy read_pack_verifications on pack_verifications for select using (auth_role() is not null);
