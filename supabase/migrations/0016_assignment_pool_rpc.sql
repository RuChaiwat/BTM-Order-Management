-- Work Assignment's new Criteria drill-down (Backlog by Order Date -> Zone -> Complexity) needs
-- the same SQL-side aggregation as Order Pool overview (migration 0014) and for the same reason:
-- a plain select scoped only by warehouse_code/status hits Supabase/PostgREST's project-level Max
-- Rows cap once the assignable pool (status='new') passes it, so every aggregate here is computed
-- in SQL and returns only a handful of summary rows regardless of pool size.

create or replace function get_new_orders_backlog_by_date(p_warehouse_code text)
returns table (order_date date, order_count bigint, sum_pieces numeric)
language sql
stable
as $$
  select o.original_order_date as order_date, count(*) as order_count, coalesce(sum(o.planned_pieces), 0) as sum_pieces
  from orders o
  where o.warehouse_code = p_warehouse_code
    and o.status = 'new'
  group by o.original_order_date
  order by o.original_order_date;
$$;

create or replace function get_new_orders_zone_density_by_date(p_warehouse_code text, p_order_date date)
returns table (zone_code text, order_count bigint, sum_qty numeric)
language sql
stable
as $$
  select ol.zone_code, count(distinct ol.order_id) as order_count, sum(ol.qty) as sum_qty
  from order_lines ol
  join orders o on o.order_id = ol.order_id
  where o.warehouse_code = p_warehouse_code
    and o.status = 'new'
    and o.original_order_date = p_order_date
    and ol.zone_code is not null
  group by ol.zone_code
  order by sum_qty desc;
$$;

create or replace function get_new_orders_complexity_by_date_zone(
  p_warehouse_code text, p_order_date date, p_zone_code text, p_green_min numeric, p_red_max numeric
)
returns table (band text, order_count bigint, sum_pieces numeric)
language sql
stable
as $$
  with pool as (
    select distinct o.order_id, o.planned_pieces, o.unique_sku_count
    from orders o
    join order_lines ol on ol.order_id = o.order_id
    where o.warehouse_code = p_warehouse_code
      and o.status = 'new'
      and o.original_order_date = p_order_date
      and ol.zone_code = p_zone_code
  ), banded as (
    select
      planned_pieces,
      case
        when coalesce(unique_sku_count, 0) = 0 then 'yellow'
        when (planned_pieces::numeric / unique_sku_count) >= p_green_min then 'green'
        when (planned_pieces::numeric / unique_sku_count) <= p_red_max then 'red'
        else 'yellow'
      end as band
    from pool
  )
  select band, count(*) as order_count, coalesce(sum(planned_pieces), 0) as sum_pieces
  from banded
  group by band;
$$;

-- Returns the actual order rows for a date+zone selection (the Unassigned Order Pool list),
-- paginated server-side via p_limit/p_offset -- a single date+zone slice of the pool is small
-- enough in practice that this and the complexity banding above stay well under the row cap, but
-- pagination is still done here rather than trusting that to hold at every warehouse's scale.
create or replace function get_new_orders_by_date_zone(
  p_warehouse_code text, p_order_date date, p_zone_code text, p_limit int default 50, p_offset int default 0
)
returns table (order_id uuid, order_no text, store_code text, planned_pieces int, unique_sku_count int, total_count bigint)
language sql
stable
as $$
  select distinct
    o.order_id, o.order_no, o.store_code, o.planned_pieces, o.unique_sku_count,
    count(*) over () as total_count
  from orders o
  join order_lines ol on ol.order_id = o.order_id
  where o.warehouse_code = p_warehouse_code
    and o.status = 'new'
    and o.original_order_date = p_order_date
    and ol.zone_code = p_zone_code
  order by o.order_no
  limit p_limit offset p_offset;
$$;

grant execute on function get_new_orders_backlog_by_date(text) to authenticated, service_role;
grant execute on function get_new_orders_zone_density_by_date(text, date) to authenticated, service_role;
grant execute on function get_new_orders_complexity_by_date_zone(text, date, text, numeric, numeric) to authenticated, service_role;
grant execute on function get_new_orders_by_date_zone(text, date, text, int, int) to authenticated, service_role;
