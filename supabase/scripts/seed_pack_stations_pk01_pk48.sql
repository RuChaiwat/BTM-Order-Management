-- One-off data script (not a migration): create Pack Stations PK-01 .. PK-48 for warehouse DC002,
-- named "โต๊ะแพ็ก 1" .. "โต๊ะแพ็ก 48", active.
-- Safe to re-run: a station code that already exists is left untouched (on conflict do nothing).
-- Run in Supabase > SQL Editor.

insert into pack_stations (station_code, name, warehouse_code, active)
select
  'PK-' || lpad(n::text, 2, '0'),
  'โต๊ะแพ็ก ' || n,
  'DC002',
  true
from generate_series(1, 48) as n
on conflict (station_code) do nothing;

-- Check: should list 48 rows PK-01 .. PK-48
select station_code, name, warehouse_code, active
from pack_stations
where station_code like 'PK-%'
order by station_code;
