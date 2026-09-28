-- Productivity/SLA/Short Pick (§12.2/§13) previously defined "Orders Completed" as a raw count of
-- picker_completions rows in the trailing window -- the picker's own coarse self-report, which
-- never matches "Completed" anywhere else in this app (Operations Dashboard, Control Tower: always
-- admin-verified final_closed_100/short, see dashboard.ts's TERMINAL_CLOSED_STATUSES). It also read
-- picker_completions with a plain .gte() filter across ALL warehouses with no .range() paging, so
-- past Supabase's default row cap it could silently drop this warehouse's own rows behind another
-- warehouse's completions -- same class of bug migration 0022 fixed for order_alerts/
-- picker_completions elsewhere.
--
-- This RPC lets productivity.ts scope admin_verifications (has no warehouse_code column, like
-- picker_completions/order_alerts) to exactly this warehouse's order_ids via fetchScopedByOrderIds,
-- so "Completed" here can be redefined to mean the same thing it means everywhere else: a
-- decision='final_close' row, which is also the only place picker_completion_lines (and therefore
-- the Short Pick Reasons breakdown) is ever populated.

create or replace function get_admin_verifications_by_ids(p_order_ids uuid[])
returns setof admin_verifications
language sql
stable
as $$
  select * from admin_verifications where order_id = any(p_order_ids);
$$;

grant execute on function get_admin_verifications_by_ids(uuid[]) to authenticated, service_role;
