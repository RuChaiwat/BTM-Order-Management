-- =====================================================================================
-- Clear ALL transaction data (test data) -- keeps master data and configuration.
-- ล้างข้อมูล Transaction ทั้งหมด (ข้อมูลทดสอบ) -- ไม่แตะ Master / Config
--
-- !!! ลบแล้วกู้คืนไม่ได้ · CANNOT BE UNDONE !!!
-- ใช้ก่อนขึ้นระบบจริง หรือเมื่อต้องการล้างข้อมูลทดสอบเท่านั้น
-- รันใน Supabase Dashboard > SQL Editor (ทั้งไฟล์)
--
-- ลบ (Transaction):
--   import_batches, import_errors                   Order Import
--   orders, order_lines                             Orders
--   consolidation_batches, consolidation_orders     Consolidation
--   assignment_batches, assignment_orders           Work Assignment
--   picker_completions, picker_completion_lines     Picker Completion
--   admin_verifications                             Admin Verification
--   pack_sessions, pack_issues, pack_issue_lines    Packing / Pack Issue
--   pack_verifications, pack_verification_lines     Admin Pack Verify
--   status_history, audit_logs                      ประวัติสถานะ / Audit log
--   export_jobs, purge_log                          ประวัติ Export / Purge
--
-- เก็บไว้ (Master / Config):
--   warehouses, locations, aisle_sequence, employees_users (+ บัญชี Login),
--   pickers, picker_employment_types, reason_master, pack_issue_reasons,
--   pack_stations, configuration
--
-- หมายเหตุ:
--   * ใช้ TRUNCATE โดยไม่ใช้ CASCADE: ถ้ามีตารางอื่นที่ไม่อยู่ในรายการอ้างอิงตารางเหล่านี้
--     script จะ error และไม่ลบอะไรเลย (ทั้งหมดอยู่ใน transaction เดียว) -- ปลอดภัยกว่า CASCADE
--     ที่อาจลามไปลบตาราง master
--   * ไฟล์ Export ใน Storage bucket "exports" ไม่ถูกลบด้วย SQL (Supabase ไม่อนุญาต)
--     ถ้าต้องการลบ: Dashboard > Storage > exports > เลือกไฟล์ > Delete
--   * เมื่อมีตาราง transaction ใหม่ในอนาคต ต้องเพิ่มในรายการด้านล่างด้วย
-- =====================================================================================

-- ---------------------------------------------------------------- 1) ก่อนลบ: จำนวนแถว
select 'before' as step, t.table_name, t.row_count
from (
  select 'orders' as table_name, (select count(*) from orders) as row_count
  union all select 'order_lines', (select count(*) from order_lines)
  union all select 'import_batches', (select count(*) from import_batches)
  union all select 'consolidation_batches', (select count(*) from consolidation_batches)
  union all select 'assignment_batches', (select count(*) from assignment_batches)
  union all select 'picker_completions', (select count(*) from picker_completions)
  union all select 'admin_verifications', (select count(*) from admin_verifications)
  union all select 'pack_sessions', (select count(*) from pack_sessions)
  union all select 'pack_issues', (select count(*) from pack_issues)
  union all select 'pack_verifications', (select count(*) from pack_verifications)
  union all select 'status_history', (select count(*) from status_history)
  union all select 'audit_logs', (select count(*) from audit_logs)
  union all select 'export_jobs', (select count(*) from export_jobs)
) t;

-- ---------------------------------------------------------------- 2) ลบ
begin;

truncate table
  -- Packing (ลูกก่อน)
  pack_verification_lines,
  pack_verifications,
  pack_issue_lines,
  pack_issues,
  pack_sessions,
  -- Picking / Admin verification
  picker_completion_lines,
  picker_completions,
  admin_verifications,
  -- Work Assignment / Consolidation
  assignment_orders,
  assignment_batches,
  consolidation_orders,
  consolidation_batches,
  -- Orders / Import
  status_history,
  order_lines,
  orders,
  import_errors,
  import_batches,
  -- Logs
  purge_log,
  export_jobs,
  audit_logs
restart identity;

commit;

-- ---------------------------------------------------------------- 3) หลังลบ: ต้องเป็น 0 ทั้งหมด / Master ยังอยู่
select 'after' as step, t.table_name, t.row_count
from (
  select 'orders' as table_name, (select count(*) from orders) as row_count
  union all select 'order_lines', (select count(*) from order_lines)
  union all select 'pack_sessions', (select count(*) from pack_sessions)
  union all select 'pack_issues', (select count(*) from pack_issues)
  union all select 'audit_logs', (select count(*) from audit_logs)
  union all select '(master) pickers', (select count(*) from pickers)
  union all select '(master) pack_stations', (select count(*) from pack_stations)
  union all select '(master) locations', (select count(*) from locations)
  union all select '(master) employees_users', (select count(*) from employees_users)
  union all select '(config) configuration', (select count(*) from configuration)
) t;
