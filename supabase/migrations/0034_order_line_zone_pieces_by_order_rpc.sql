-- get_order_line_zone_pieces_by_ids (migration 0026) fixed Matching Dashboard's Zone Distribution
-- by summing real per-zone order_lines.qty instead of attributing an order's whole planned_pieces
-- to every zone it touches -- but it only returns one row PER ZONE (summed across every order_id
-- given), with no per-order breakdown. Zone Dashboard / Operations Dashboard's Zone Status /
-- Control Tower's Zone Overview have the IDENTICAL "whole order's pieces repeated in every zone
-- it touches" problem (confirmed: their zone totals summed to more than Backlog's own Total
-- Pieces for the same orders) but can't reuse 0026's RPC as-is, because they need to know EACH
-- order's own pending/done status before deciding whether that order's zone pieces count toward
-- "pending" -- they aggregate per order first, then per zone, not straight to one number per zone.
--
-- Same per-zone real-quantity math as 0026, grouped by order_id too so callers keep their
-- existing per-order pending/done logic and just swap what "this order's pieces in this zone" means.
create or replace function get_order_line_zone_pieces_by_order(p_order_ids uuid[])
returns table (order_id uuid, zone_code text, pieces numeric)
language sql
stable
as $$
  select ol.order_id, ol.zone_code, sum(ol.qty) as pieces
  from order_lines ol
  where ol.order_id = any(p_order_ids)
    and ol.zone_code is not null
  group by ol.order_id, ol.zone_code;
$$;

grant execute on function get_order_line_zone_pieces_by_order(uuid[]) to authenticated, service_role;
