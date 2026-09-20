-- Further performance pass after migration 0022: order_alerts/picker_completions were the first
-- fix, but dashboard.ts/controlTower.ts/backlog.ts each ALSO fetch every order_lines row for the
-- warehouse (order_id, zone_code only) purely to build a "which zone(s) does this order touch"
-- map. order_lines is the single largest table in this schema by a wide margin -- the user's own
-- WMS exports ~15,000-20,000 lines/day against ~1,400-1,500 orders/day, roughly 10x more rows than
-- orders itself -- so pulling every line, paginated 1000 rows at a time, on every single page load
-- of three different pages is the dominant cost once real data volume accumulates, independent of
-- indexing (idx_order_lines_zone/idx_order_lines_order already exist -- the problem was never a
-- missing index, it was transferring far more rows than the caller actually needed).
--
-- These three callers only ever need DISTINCT (order_id, zone_code) pairs, not one row per line --
-- an order with 10 lines all in zone A1 only needs to be counted once for that zone. Aggregating
-- that server-side, in the same style as get_order_pool_zone_density (migration 0014), typically
-- returns a small fraction of the raw order_lines row count.

create or replace function get_order_zone_touches(p_warehouse_code text)
returns table (order_id uuid, zone_code text)
language sql
stable
as $$
  select distinct ol.order_id, ol.zone_code
  from order_lines ol
  where ol.warehouse_code = p_warehouse_code
    and ol.zone_code is not null;
$$;

grant execute on function get_order_zone_touches(text) to authenticated, service_role;
