-- Scale prep (3,000 orders/day, ~60 days kept): pages used to read EVERY order of the warehouse
-- and filter by date in JS. These indexes + RPC let them ask the database for just the slice
-- they show.

create index if not exists idx_picker_completions_time on picker_completions(picker_completed_time);
create index if not exists idx_orders_wh_status on orders(warehouse_code, status);
create index if not exists idx_orders_wh_created on orders(warehouse_code, created_at);
create index if not exists idx_orders_wh_pack_ready on orders(warehouse_code, pack_ready_at);
create index if not exists idx_pack_sessions_wh_finished on pack_sessions(warehouse_code, finished_at);

-- Picker completions confirmed in [p_from, p_to) for one warehouse, with the order fields the
-- productivity / issue pages need -- one round trip instead of "all orders -> all completions".
create or replace function get_completions_in_range(p_warehouse_code text, p_from timestamptz, p_to timestamptz)
returns table (
  completion_id uuid,
  order_id uuid,
  actual_pieces int,
  result text,
  picker_completed_time timestamptz,
  planned_pieces int,
  assigned_time timestamptz,
  assignment_batch_id uuid,
  consolidation_batch_id uuid,
  status text
)
language sql
stable
as $$
  select c.completion_id, c.order_id, c.actual_pieces, c.result, c.picker_completed_time,
         o.planned_pieces, o.assigned_time, o.assignment_batch_id, o.consolidation_batch_id, o.status::text
  from picker_completions c
  join orders o on o.order_id = c.order_id
  where o.warehouse_code = p_warehouse_code
    and c.picker_completed_time >= p_from
    and c.picker_completed_time < p_to
  order by c.picker_completed_time, c.completion_id;
$$;

grant execute on function get_completions_in_range(text, timestamptz, timestamptz) to authenticated, service_role;

notify pgrst, 'reload schema';
