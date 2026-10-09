-- §Picker Management: Employment Type is configurable master data (Full Time / Part Time / Full
-- Time OS / Temporary Job, extensible later from Configuration without a code deploy) -- same
-- small admin-managed lookup table pattern as reason_master (0001/0002), referenced from pickers.

create table picker_employment_types (
  type_code text primary key,
  label_en text not null,
  label_th text,
  active boolean not null default true,
  created_by text references employees_users(user_id),
  updated_by text references employees_users(user_id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Same "any signed-in role can read, writes are admin-only via the service-role client" pattern
-- as reason_master/pickers (0002/0015).
alter table picker_employment_types enable row level security;
create policy read_picker_employment_types on picker_employment_types for select using (auth_role() is not null);

insert into picker_employment_types (type_code, label_en, label_th) values
  ('full_time', 'Full Time', 'พนักงานประจำ'),
  ('part_time', 'Part Time', 'พนักงานพาร์ทไทม์'),
  ('full_time_os', 'Full Time OS', 'พนักงานประจำ (Outsource)'),
  ('temporary', 'Temporary Job', 'พนักงานชั่วคราว');

-- Nullable -- existing pickers predate this field and aren't assumed to be any particular type.
alter table pickers add column employment_type text references picker_employment_types(type_code);
