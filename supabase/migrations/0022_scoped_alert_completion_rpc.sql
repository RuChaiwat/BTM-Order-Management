-- Performance: dashboard.ts/controlTower.ts/zoneDashboard.ts/backlog.ts/verification.ts each fetch
-- the ENTIRE order_alerts view and/or picker_completions table (paginated, unscoped) on every page
-- load, then filter down to this warehouse's own orders in JS -- a deliberate workaround (see
-- those files' own comments) for PostgREST encoding an .in() filter's values into the request URL,
-- which fails outright past a few thousand UUIDs. That workaround has its own scaling problem: as
-- these tables accumulate history across warehouses, every page load re-transfers and re-filters
-- rows that were never relevant to begin with, and it only gets slower over time.
--
-- An RPC call sends its parameters in the POST body, not the URL, so a uuid[] of order_ids can be
-- passed directly without hitting the URL-length limit -- Postgres does the filtering server-side,
-- using order_alerts' underlying orders.order_id primary key / picker_completions.order_id unique
-- index, and only the relevant rows cross the wire. Callers still page through the result via
-- fetchAllRows()+.range() exactly as before, so this remains immune to the separate Max Rows cap
-- (migration 0012) regardless of how large order_ids gets.

create or replace function get_order_alerts_by_ids(p_order_ids uuid[])
returns setof order_alerts
language sql
stable
as $$
  select * from order_alerts where order_id = any(p_order_ids);
$$;

create or replace function get_picker_completions_by_ids(p_order_ids uuid[])
returns setof picker_completions
language sql
stable
as $$
  select * from picker_completions where order_id = any(p_order_ids);
$$;

grant execute on function get_order_alerts_by_ids(uuid[]) to authenticated, service_role;
grant execute on function get_picker_completions_by_ids(uuid[]) to authenticated, service_role;
