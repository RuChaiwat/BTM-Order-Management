-- /api/matching/run fetched order_lines with a plain `.in('order_id', orderIds)` -- the same
-- URL-length trap migration 0022 already fixed for order_alerts/picker_completions: PostgREST
-- encodes an .in() filter's values into the request URL, which fails outright once orderIds gets
-- into the hundreds/thousands (a single Order Date can span most of a day's ~1,400-1,500 orders).
-- That request errors out, fetchAllRows logs it and returns an empty array, every order silently
-- reads as skus:[], and the matching engine's own eligible filter (uniqueSkuCount<=max AND
-- skus.length>0) then excludes literally everything -- Run Matching looked like it did nothing,
-- with no error surfaced anywhere.
--
-- Same fix as migration 0022: an RPC sends its uuid[] argument in the POST body, not the URL, so
-- it stays correct no matter how many orders one date has.

create or replace function get_order_lines_by_ids(p_order_ids uuid[])
returns table (order_id uuid, sku text)
language sql
stable
as $$
  select ol.order_id, ol.sku
  from order_lines ol
  where ol.order_id = any(p_order_ids);
$$;

grant execute on function get_order_lines_by_ids(uuid[]) to authenticated, service_role;
