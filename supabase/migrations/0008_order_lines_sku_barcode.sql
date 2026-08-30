-- Bug fix: the WMS Item No. (`order_lines.sku`) is Beautrium's internal code — it is never the
-- barcode physically printed on the item. The barcode on the item is the supplier's barcode, a
-- separate value the WMS export carries alongside Item No.. The Consolidation Pick Report was
-- rendering a Code128 barcode of the INTERNAL sku, which cannot ever scan against the physical
-- item — a real defect, not a display nicety. Adding the field the import/report were missing.
--
-- Nullable (not NOT NULL): existing order_lines rows imported before this migration have no value
-- for it, and it would be wrong to invent one. New imports are required to supply it at the
-- application layer (app/api/imports/orders/route.ts) — see that file for the enforcement.
alter table order_lines add column sku_barcode text;
