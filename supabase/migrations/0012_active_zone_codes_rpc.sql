-- The previous "fix" for getActiveZoneCodes added an explicit client-side .limit(200000), on the
-- mistaken assumption that this overrides Supabase/PostgREST's project-level "Max Rows" API
-- setting (db-max-rows, default 1000). It does not: that setting is a hard server-side ceiling —
-- a client .limit() can only ask for fewer rows, never more. Once the real Location Master loaded
-- (55,000+ rows for one warehouse, inserted aisle-by-aisle), any plain `select zone_code` still
-- came back capped at the server's max-rows, and since rows are returned in insertion order and
-- Aisle A1 alone has 5,400+ bins, every one of those capped rows was Zone A1 — so the dashboards'
-- zone lists collapsed to a single zone no matter how it was queried from the client.
--
-- Fix: compute the distinct zone list in the database via an aggregate query (DISTINCT), which
-- returns only the ~11 actual zones regardless of how many location rows exist underneath, so it
-- is never subject to the row cap and scales correctly as Location Master grows.
create or replace function get_active_zone_codes(p_warehouse_code text)
returns table (zone_code text)
language sql
stable
as $$
  select distinct l.zone_code
  from locations l
  where l.warehouse_code = p_warehouse_code
    and l.active = true
    and l.zone_code is not null
  order by l.zone_code;
$$;

grant execute on function get_active_zone_codes(text) to authenticated, service_role;
