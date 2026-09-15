-- Split Picker out of employees_users into its own table with no login capability.
--
-- Why: Pickers were previously just employees_users rows with role='picker', which meant every
-- picker got a Supabase Auth login (email + password) via the same /api/users flow as System
-- Admin/Supervisor/etc. Business requirement now is explicit: Pickers must NOT be able to log
-- into the order management system at all, must be managed in their own table (separate from
-- office/admin users), and get identified by an Admin-assigned badge code (scanned at Assignment
-- time) rather than picked from a login-account dropdown.
--
-- This migration:
--   1. Creates `pickers` — no auth_user_id, no email/password, just a badge_code for scanning.
--   2. Copies every existing role='picker' employees_users row into it (badge_code defaults to
--      the old user_id so nothing is silently blank; Admin can assign a real badge code
--      afterward via the new Picker Management page).
--   3. Repoints assignment_batches.picker_id at pickers(picker_id) instead of
--      employees_users(user_id) -- the id values are unchanged by the copy, so existing
--      assignment history keeps resolving correctly.
--   4. Deletes the role='picker' rows from employees_users, which is what actually revokes
--      their login: getSessionUser() looks up the caller's employees_users row by auth_user_id,
--      and finds nothing once it's gone, so requireRole() treats them as not signed in
--      regardless of whether their Supabase Auth account technically still exists. (The
--      auth.users row itself is not deleted here -- this migration only has SQL access, not the
--      Supabase Auth Admin API. If desired, remove those leftover logins from Supabase Studio ->
--      Authentication -> Users; they can no longer reach anything either way.)
--
-- 'picker' is left in the user_role enum (Postgres can't drop an enum value) and the RLS
-- policies that branch on auth_role() = 'picker' are left in place -- both are simply dead code
-- now that no employees_users row can ever have that role again going forward (enforced at the
-- application layer in /api/users), not something that needs a schema-level removal.

create table pickers (
  picker_id text primary key check (char_length(picker_id) <= 10), -- business id, e.g. P0001 (same length rule as employees_users, migration 0005)
  badge_code text not null unique,                     -- scanned at Assignment time to identify the picker
  name_en text not null,
  name_th text,
  warehouse_code text references warehouses(warehouse_code),
  zone_scope text[] not null default '{}',             -- zones this picker is scoped to (empty = all)
  active boolean not null default true,
  shift_label text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index idx_pickers_warehouse on pickers(warehouse_code);
create unique index uq_pickers_badge_code on pickers(badge_code);

-- Same "any signed-in role can read" pattern as locations/reason_master (0002) -- pickers are
-- master data referenced across Work Assignment/Dashboard/Productivity, writes are admin-only
-- and go through the service-role client (enforced in the API route, not by RLS, matching how
-- every other admin-managed table in this app is written).
alter table pickers enable row level security;
create policy read_pickers on pickers for select using (auth_role() is not null);

insert into pickers (picker_id, badge_code, name_en, name_th, warehouse_code, zone_scope, active, shift_label, created_at, updated_at)
select user_id, user_id, name_en, name_th, warehouse_code, zone_scope, active, shift_label, created_at, updated_at
from employees_users
where role = 'picker';

alter table assignment_batches drop constraint if exists assignment_batches_picker_id_fkey;
alter table assignment_batches
  add constraint assignment_batches_picker_id_fkey
  foreign key (picker_id) references pickers(picker_id);

delete from employees_users where role = 'picker';
