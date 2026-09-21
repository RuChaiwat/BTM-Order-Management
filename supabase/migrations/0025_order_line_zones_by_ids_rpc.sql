-- Same URL-length trap as migration 0024, found in the same Order Consolidation module: Matching
-- Dashboard's Zone Distribution breakdown queries order_lines with a plain
-- `.in('order_id', orderIds)` to find which zones the date's orders touch. Once a single Order
-- Date has hundreds/thousands of orders (exactly the volume that broke Run Matching), that request
-- fails outright and Zone Distribution silently renders empty, with no error surfaced.
--
-- Same fix: an RPC that takes the id array in the POST body instead of the URL. Distinct
-- (order_id, zone_code) pairs only, same as get_order_zone_touches (migration 0023) -- this is
-- that same idea scoped to a specific set of order_ids instead of a whole warehouse.

create or replace function get_order_line_zones_by_ids(p_order_ids uuid[])
returns table (order_id uuid, zone_code text)
language sql
stable
as $$
  select distinct ol.order_id, ol.zone_code
  from order_lines ol
  where ol.order_id = any(p_order_ids)
    and ol.zone_code is not null;
$$;

grant execute on function get_order_line_zones_by_ids(uuid[]) to authenticated, service_role;
