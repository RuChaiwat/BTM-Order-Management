-- Order Pool overview (Zone Density + Order Complexity) was computing both breakdowns by pulling
-- every pending order + order_line into JS and aggregating there. That's the same Supabase/
-- PostgREST project-level "Max Rows" trap fixed for Zone Status in migration 0012: a client-side
-- .limit() can only ever LOWER that server-side cap, never raise it, so once the pending pool
-- (a single real WMS import) passed the project's Max Rows setting, both queries silently
-- truncated -- explaining "1000 orders in pool" instead of the real 1494, and Order Density by
-- Zone coming back completely empty once the truncated slice of order_lines happened not to
-- include enough zone-resolved rows. Doing the aggregation in SQL instead returns only a handful
-- of summary rows (one per zone, one per complexity band) no matter how large the pending pool
-- gets, so it's immune to the row cap by construction.

create or replace function get_order_pool_zone_density(p_warehouse_code text)
returns table (zone_code text, order_count bigint, sum_qty numeric)
language sql
stable
as $$
  select ol.zone_code, count(distinct ol.order_id) as order_count, sum(ol.qty) as sum_qty
  from order_lines ol
  join orders o on o.order_id = ol.order_id
  where o.warehouse_code = p_warehouse_code
    and o.status = 'new'
    and ol.zone_code is not null
  group by ol.zone_code
  order by sum_qty desc;
$$;

create or replace function get_order_pool_complexity(p_warehouse_code text, p_green_min numeric, p_red_max numeric)
returns table (band text, order_count bigint, sum_pieces numeric)
language sql
stable
as $$
  with banded as (
    select
      o.planned_pieces,
      case
        when coalesce(o.unique_sku_count, 0) = 0 then 'yellow'
        when (o.planned_pieces::numeric / o.unique_sku_count) >= p_green_min then 'green'
        when (o.planned_pieces::numeric / o.unique_sku_count) <= p_red_max then 'red'
        else 'yellow'
      end as band
    from orders o
    where o.warehouse_code = p_warehouse_code
      and o.status = 'new'
  )
  select band, count(*) as order_count, coalesce(sum(planned_pieces), 0) as sum_pieces
  from banded
  group by band;
$$;

grant execute on function get_order_pool_zone_density(text) to authenticated, service_role;
grant execute on function get_order_pool_complexity(text, numeric, numeric) to authenticated, service_role;
