-- Seed data: master data and default configuration per §17 / §17.1 / §26.
-- employees_users rows are NOT seeded here with auth_user_id (no real auth.users exist yet at
-- migration time) — link them via the app's user-invite flow, or run
-- `update employees_users set auth_user_id = '<uuid>' where user_id = 'U0001'` after inviting.

insert into warehouses (warehouse_code, name) values
  ('DC002', 'Bangna DC')
on conflict (warehouse_code) do nothing;

-- §17.1 Short Pick Reason master — seeded exactly as confirmed by Business, 27 Aug 2026.
insert into reason_master (reason_code, reason_type, label_en, label_th) values
  ('DAMAGED', 'short_pick', 'Damaged goods', 'สินค้าเสียหาย'),
  ('EXPIRED', 'short_pick', 'Expired', 'หมดอายุ'),
  ('NOT_FOUND', 'short_pick', 'Item Not Found', 'หาสินค้าไม่เจอ')
on conflict (reason_code) do nothing;

-- Minimal seed for the cancel-reason master — the requirement seeds short_pick reasons
-- explicitly (§17.1) but not cancel reasons; these are a reasonable placeholder set pending
-- Business confirmation (candidate Appendix D addition), maintainable via the same UI either way.
insert into reason_master (reason_code, reason_type, label_en, label_th) values
  ('CANCEL_DUPLICATE', 'cancel', 'Duplicate order', 'ออเดอร์ซ้ำ'),
  ('CANCEL_CUSTOMER', 'cancel', 'Store/customer request', 'ร้านค้าขอยกเลิก'),
  ('CANCEL_DATA_ERROR', 'cancel', 'Data error from WMS import', 'ข้อมูลนำเข้าผิดพลาด')
on conflict (reason_code) do nothing;

-- §17 configuration defaults — all effective-dated, version 1, active.
insert into configuration (key, value, scope, version, active, change_reason) values
  ('consolidation.min_stores', '2', 'global', 1, true, 'initial default'),
  ('consolidation.target_stores', '7', 'global', 1, true, 'initial default'),
  ('consolidation.max_stores', '8', 'global', 1, true, 'initial default'),
  ('consolidation.max_orders', 'null', 'global', 1, true, 'initial default — no independent cap'),
  ('consolidation.max_unique_sku', '30', 'global', 1, true, 'initial default'),
  ('matching.p1_min_pieces', '50', 'global', 1, true, '§10.2 initial >50'),
  ('matching.p2_match_pct', '0.80', 'global', 1, true, '§10.2 initial 80%'),
  ('matching.p2_min_pieces', '50', 'global', 1, true, '§10.2 initial >50'),
  ('matching.p3_match_pct', '0.50', 'global', 1, true, '§10.2 initial 50%'),
  ('matching.p3_min_pieces', '80', 'global', 1, true, '§10.2 initial ~80'),
  ('matching.p4_match_pct', '0.30', 'global', 1, true, '§10.2 initial 30%'),
  ('matching.p4_min_pieces', '150', 'global', 1, true, '§10.2 initial >150'),
  ('assignment.target_pieces', '300', 'global', 1, true, '§12.1 initial benchmark'),
  ('assignment.low_max', '269', 'global', 1, true, '§12.1 workload band'),
  ('assignment.target_max', '300', 'global', 1, true, '§12.1 workload band'),
  ('assignment.acceptable_max', '330', 'global', 1, true, '§12.1 workload band'),
  ('order_sla.warning_minutes', '45', 'global', 1, true, 'illustrative default, matches mockups'),
  ('order_sla.overdue_minutes', '60', 'global', 1, true, 'illustrative default, matches mockups'),
  ('order_sla.critical_minutes', '120', 'global', 1, true, 'illustrative default, matches mockups'),
  ('admin_verification.warning_minutes', '20', 'global', 1, true, 'illustrative default'),
  ('admin_verification.overdue_minutes', '45', 'global', 1, true, 'illustrative default'),
  ('operational_day_cutoff', '"18:00"', 'global', 1, true, 'illustrative default, backlog calculation'),
  ('report.barcode_symbology', '"CODE128"', 'global', 1, true, '§26 default'),
  ('export.weekly_productivity_enabled', 'true', 'global', 1, true, 'initial default'),
  ('export.weekly_day_time_tz', '{"day":"Sunday","time":"23:30","timezone":"Asia/Bangkok"}', 'global', 1, true, '§20.1 default timezone'),
  ('export.drive_folder_naming', '"BTM_Productivity_YYYY-Www"', 'global', 1, true, '§20.1'),
  ('retention.transaction_days', '7', 'global', 1, true, '§20.2 default'),
  ('retention.active_warehouse_codes', '["DC002"]', 'global', 1, true, '§26 single active DC this phase')
on conflict (key, scope, version) do nothing;
