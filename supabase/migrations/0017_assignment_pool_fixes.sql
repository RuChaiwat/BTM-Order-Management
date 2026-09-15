-- Fixes two real bugs found in UAT on the new Work Assignment Criteria/Pool flow (migration 0016):
--
-- 1. get_new_orders_by_date_zone joined orders to order_lines (to filter by zone) and then took
--    `count(*) over ()` on top of a `select distinct` in the SAME select list. Window functions
--    evaluate BEFORE the final SELECT DISTINCT collapses duplicate rows, so an order with more
--    than one line in the target zone was counted once per LINE, not once per order -- the
--    returned rows were correctly deduplicated (hence the pool table looked fine), but
--    total_count (and therefore the header count and "Page X of Y" pagination) was wildly
--    inflated. Fixed by deduplicating in a CTE first, then counting over the already-distinct rows.
--    Also adds server-side complexity-band filtering and sorting -- clicking a complexity band
--    previously only filtered whatever 50 rows happened to already be loaded on the client, so a
--    band with matches spread across multiple pages showed far fewer rows than its own count said
--    it should. Now the band (and sort column/direction) narrows the query itself, so the count,
--    the page numbers, and the visible rows always agree.
--
-- 2. Adds create_assignment_batch(), an atomic replacement for the batch-insert + orders-update
--    sequence /api/assignments used to do as several separate round trips. Two Admins racing to
--    assign the same order from different machines could both pass the "is this order still
--    'new'?" check before either write landed. This function does the whole thing -- lock
--    candidate orders, verify every one is still 'new', create the batch, link the orders, and
--    flip their status -- inside a single Postgres transaction, so a losing concurrent request
--    gets a clean rejection instead of a partially-double-assigned order.

drop function if exists get_new_orders_by_date_zone(text, date, text, int, int);

create or replace function get_new_orders_by_date_zone(
  p_warehouse_code text,
  p_order_date date,
  p_zone_code text,
  p_green_min numeric,
  p_red_max numeric,
  p_band text default null,
  p_sort text default 'order_no',
  p_sort_dir text default 'asc',
  p_limit int default 15,
  p_offset int default 0
)
returns table (order_id uuid, order_no text, store_code text, planned_pieces int, unique_sku_count int, band text, total_count bigint)
language plpgsql
stable
as $$
declare
  sort_col text;
  sort_dir text;
begin
  sort_col := case p_sort
    when 'store_code' then 'store_code'
    when 'unique_sku_count' then 'unique_sku_count'
    when 'planned_pieces' then 'planned_pieces'
    else 'order_no'
  end;
  sort_dir := case when lower(coalesce(p_sort_dir, 'asc')) = 'desc' then 'desc' else 'asc' end;

  return query execute format(
    $q$
    with matching as (
      select distinct
        o.order_id, o.order_no, o.store_code, o.planned_pieces, o.unique_sku_count,
        case
          when coalesce(o.unique_sku_count, 0) = 0 then 'yellow'
          when (o.planned_pieces::numeric / o.unique_sku_count) >= $1 then 'green'
          when (o.planned_pieces::numeric / o.unique_sku_count) <= $2 then 'red'
          else 'yellow'
        end as band
      from orders o
      join order_lines ol on ol.order_id = o.order_id
      where o.warehouse_code = $3
        and o.status = 'new'
        and o.original_order_date = $4
        and ol.zone_code = $5
    )
    select order_id, order_no, store_code, planned_pieces, unique_sku_count, band,
           count(*) over () as total_count
    from matching
    where $6::text is null or band = $6
    order by %I %s, order_id asc
    limit $7 offset $8
    $q$,
    sort_col, sort_dir
  )
  using p_green_min, p_red_max, p_warehouse_code, p_order_date, p_zone_code, p_band, p_limit, p_offset;
end;
$$;

grant execute on function get_new_orders_by_date_zone(text, date, text, numeric, numeric, text, text, text, int, int) to authenticated, service_role;

create or replace function create_assignment_batch(
  p_warehouse_code text,
  p_zone_code text,
  p_picker_id text,
  p_admin_id text,
  p_order_ids uuid[],
  p_assignment_method assignment_method,
  p_linked_consolidation_batch_id uuid default null
)
returns assignment_batches
language plpgsql
as $$
declare
  v_batch assignment_batches;
  v_planned_pieces int;
  v_available_count int;
  v_workload_status text;
begin
  -- Row-lock every candidate order that's still 'new' -- a concurrent call for an overlapping
  -- order_ids set blocks here until this transaction commits or rolls back, so it always sees
  -- this call's outcome rather than racing past the same "still available?" check.
  perform 1 from orders where order_id = any(p_order_ids) and status = 'new' for update;

  select count(*), coalesce(sum(planned_pieces), 0)
    into v_available_count, v_planned_pieces
  from orders where order_id = any(p_order_ids) and status = 'new';

  if v_available_count <> array_length(p_order_ids, 1) then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;

  v_workload_status := case
    when v_planned_pieces < 270 then 'low'
    when v_planned_pieces <= 300 then 'target'
    when v_planned_pieces <= 330 then 'acceptable_over'
    else 'over'
  end;

  insert into assignment_batches
    (warehouse_code, zone_code, picker_id, admin_id, assigned_time, planned_pieces, workload_status, assignment_method, status, linked_consolidation_batch_id)
  values
    (p_warehouse_code, p_zone_code, p_picker_id, p_admin_id, now(), v_planned_pieces, v_workload_status, p_assignment_method, 'assigned', p_linked_consolidation_batch_id)
  returning * into v_batch;

  -- trg_enforce_assignment_zone_warehouse (0001) still validates each order actually has a line
  -- in this batch's zone/warehouse -- a bad order_id here aborts the whole function, same as
  -- before.
  insert into assignment_orders (assignment_batch_id, order_id, sequence, source_type, source_id)
  select
    v_batch.assignment_batch_id,
    oid,
    row_number() over (),
    case when p_linked_consolidation_batch_id is not null then 'consolidation' else 'single' end,
    p_linked_consolidation_batch_id
  from unnest(p_order_ids) as oid;

  update orders
  set status = 'assigned', assigned_time = v_batch.assigned_time, assignment_batch_id = v_batch.assignment_batch_id
  where order_id = any(p_order_ids);

  return v_batch;
end;
$$;

grant execute on function create_assignment_batch(text, text, text, text, uuid[], assignment_method, uuid) to authenticated, service_role;
