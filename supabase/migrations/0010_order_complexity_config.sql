-- Order Pool complexity classification thresholds (pieces-per-SKU ratio), per requirement
-- clarification: Green = many pieces, few SKU (easy — grab a lot of the same few items); Red =
-- few pieces, many SKU (hard — lots of walking for small quantities each); Yellow = balanced.
-- Illustrative defaults, same as order_sla.*_minutes in 0003 — move to Business-confirmed values
-- via the Configuration screen before UAT, not fixed business logic.
insert into configuration (key, value, scope, version, active, change_reason) values
  ('order_complexity.green_min_pcs_per_sku', '5', 'global', 1, true, 'illustrative default — >=5 pcs/SKU is easy to pick'),
  ('order_complexity.red_max_pcs_per_sku', '2', 'global', 1, true, 'illustrative default — <=2 pcs/SKU is hard to pick')
on conflict (key, scope, version) do nothing;
