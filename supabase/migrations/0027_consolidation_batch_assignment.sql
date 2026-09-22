-- Closes the tracking gap discussed with the user: orders that only went through Order
-- Consolidation sat at status='new' forever (Approve/Picking/At Consolidation/Sorting/Completed
-- never touched orders.status), so they were invisible to Pick Completion, Admin Verification,
-- Backlog Monitor, Active Pickers, and Productivity -- everything that tracks "who's picking what
-- right now" is keyed off assignment_batches / orders.status, not consolidation_batches.status.
--
-- Fix: Approving a consolidation batch now ALSO creates a real assignment_batches row (reusing
-- create_assignment_batch, migration 0017, which already had a `linked_consolidation_batch_id`
-- parameter built in but never wired up to any UI) and assigns every order in the batch to a
-- picker, exactly like a direct Work Assignment. The orders then flow through the picker's normal
-- Pick Completion -> Admin Verification pipeline, and every dashboard that already tracks that
-- pipeline picks them up automatically -- no per-dashboard changes needed.
--
-- A consolidation batch groups orders by SKU/store similarity, not by zone, so its SKUs can
-- legitimately span multiple zones -- FR-030's "one batch, one zone" rule was written for the
-- direct-assignment path and doesn't apply here. Rather than relaxing that rule everywhere, these
-- batches get a literal zone_code of 'MULTI' and the zone-match trigger below explicitly skips
-- its per-line check for them. 'MULTI' never matches a real zone_code, so these batches are
-- correctly excluded from every existing per-zone breakdown (Zone Status, Zone Overview, Zone
-- Dashboard all iterate the real zones list) while still counting normally in warehouse-wide
-- aggregates (Active Pickers, Backlog, Productivity), since those key off orders.status /
-- assignment_batches.picker_id, not zone_code.

create or replace function enforce_assignment_zone_warehouse()
returns trigger as $$
declare
  batch_zone text;
  batch_warehouse text;
  batch_consol_id uuid;
  order_status_val order_status;
  line_match_count int;
begin
  select zone_code, warehouse_code, linked_consolidation_batch_id into batch_zone, batch_warehouse, batch_consol_id
  from assignment_batches where assignment_batch_id = new.assignment_batch_id;

  select status into order_status_val from orders where order_id = new.order_id;
  if order_status_val = 'cancelled' then
    raise exception 'Order % is Cancelled and cannot be Assigned (FR-029)', new.order_id;
  end if;

  if batch_consol_id is not null then
    return new;
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

-- Wraps create_assignment_batch + the consolidation_batches status flip in one transaction, so an
-- Admin can never end up with orders assigned to a picker but the batch still showing "Pending
-- Approval" (or vice versa) if one half fails.
create or replace function approve_consolidation_batch(p_consol_batch_id uuid, p_picker_id text, p_admin_id text)
returns assignment_batches
language plpgsql
as $$
declare
  v_order_ids uuid[];
  v_warehouse_code text;
  v_batch assignment_batches;
  v_now timestamptz := now();
begin
  select array_agg(order_id), min(warehouse_code) into v_order_ids, v_warehouse_code
  from orders where consolidation_batch_id = p_consol_batch_id;

  if v_order_ids is null or array_length(v_order_ids, 1) = 0 then
    raise exception 'NO_ORDERS_IN_BATCH';
  end if;

  v_batch := create_assignment_batch(v_warehouse_code, 'MULTI', p_picker_id, p_admin_id, v_order_ids, 'barcode_scan', p_consol_batch_id);

  update consolidation_batches
  set status = 'report_released', released_at = v_now, report_generated_at = v_now
  where consol_batch_id = p_consol_batch_id;

  return v_batch;
end;
$$;

grant execute on function approve_consolidation_batch(uuid, text, text) to authenticated, service_role;
