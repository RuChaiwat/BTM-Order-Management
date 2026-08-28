-- Bug fix: enforce_assignment_zone_warehouse() is a BEFORE INSERT trigger, which must always
-- RETURN NEW (or NULL) — the success path fell through with no RETURN at all, producing
-- "control reached end of trigger procedure without RETURN" on every insert that should have
-- been allowed. The RAISE EXCEPTION branches were always fine (they abort immediately); only the
-- success path was missing its return.
create or replace function enforce_assignment_zone_warehouse()
returns trigger as $$
declare
  batch_zone text;
  batch_warehouse text;
  order_status_val order_status;
  line_match_count int;
begin
  select zone_code, warehouse_code into batch_zone, batch_warehouse
  from assignment_batches where assignment_batch_id = new.assignment_batch_id;

  select status into order_status_val from orders where order_id = new.order_id;
  if order_status_val = 'cancelled' then
    raise exception 'Order % is Cancelled and cannot be Assigned (FR-029)', new.order_id;
  end if;

  select count(*) into line_match_count
  from order_lines
  where order_id = new.order_id
    and zone_code = batch_zone
    and warehouse_code = batch_warehouse;

  if line_match_count = 0 then
    raise exception 'Order % has no lines in Zone % / Warehouse % — Assignment Batch must be confined to a single Zone and Warehouse (FR-030)',
      new.order_id, batch_zone, batch_warehouse;
  end if;

  return new;
end;
$$ language plpgsql;
