-- Matching Dashboard's Order Distribution by Zone was built from get_order_line_zones_by_ids
-- (migration 0025), which returns DISTINCT (order_id, zone_code) pairs -- fine for "how many
-- orders touch this zone" (the Operations Dashboard / Control Tower convention, where an order
-- touching 3 zones deliberately counts its full pieces toward each one, and the column is never
-- meant to be summed down the list). Zone Distribution needs a different number: the actual PIECES
-- physically sitting in each zone, i.e. sum(order_lines.qty) for the lines really stored there --
-- not an order's total pieces repeated once per zone it happens to touch, which inflated the
-- column's sum well past Matched Orders' own pieces total.
--
-- Aggregates server-side (one row per zone, not one per order/zone pair or per line) so this stays
-- small regardless of order/line volume.

create or replace function get_order_line_zone_pieces_by_ids(p_order_ids uuid[])
returns table (zone_code text, pieces numeric)
language sql
stable
as $$
  select ol.zone_code, sum(ol.qty) as pieces
  from order_lines ol
  where ol.order_id = any(p_order_ids)
    and ol.zone_code is not null
  group by ol.zone_code;
$$;

grant execute on function get_order_line_zone_pieces_by_ids(uuid[]) to authenticated, service_role;
