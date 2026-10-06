-- order_alerts (0002, corrected by 0030) still computed time_alert in SQL against the 45/60/120
-- Picking thresholds hardcoded directly in the CASE expression, with no Verification equivalent
-- at all until 0030 added one -- also hardcoded. Every OTHER business threshold in this app
-- (matching.*, consolidation.*, order_complexity.*, picker_productivity.*) is configurable via the
-- `configuration` table and read in JS via getActiveConfig() (see src/lib/configCatalog.ts) --
-- order_alerts was the one exception, and it's why Business couldn't tune these without a code
-- change despite order_sla.*/admin_verification.* already being seeded back in 0003.
--
-- This migration drops time_alert from the view -- it's now computed in JS (src/lib/orderAlerts.ts)
-- from elapsed_minutes against configurable thresholds, consistent with everything else -- and
-- seeds the one missing key needed to complete Verification's own Warning/Overdue/Critical set
-- (0003 only ever seeded warning_minutes/overdue_minutes for admin_verification.*).
create or replace view order_alerts as
select
  o.order_id,
  o.status,
  o.assigned_time,
  o.picker_completed_time,
  case
    when o.status in ('picker_completed_100', 'picker_completed_short') and o.picker_completed_time is not null
      then extract(epoch from (now() - o.picker_completed_time)) / 60
    when o.status in ('assigned', 'in_progress') and o.assigned_time is not null
      then extract(epoch from (now() - o.assigned_time)) / 60
    else extract(epoch from (coalesce(o.picker_completed_time, now()) - o.assigned_time)) / 60
  end as elapsed_minutes,
  case when o.status in ('assigned', 'in_progress') and current_date > o.original_order_date
    then true else false end as is_picking_backlog,
  case when o.status in ('picker_completed_100', 'picker_completed_short')
    then true else false end as is_verification_backlog
from orders o;

comment on view order_alerts is
  'Derived Backlog conditions per §13. elapsed_minutes measures from each phase''s own current '
  'pending step (assigned_time while picking, picker_completed_time while awaiting verification -- '
  'see migration 0030). time_alert (Warning/Overdue/Critical) moved out of this view into JS '
  '(src/lib/orderAlerts.ts), computed against configurable thresholds (configuration keys '
  'order_sla.*/admin_verification.*, editable on the Configuration page) -- see migration 0031.';

insert into configuration (key, value, scope, version, active, change_reason)
values ('admin_verification.critical_minutes', '90', 'global', 1, true, 'illustrative default, completes the Warning/Overdue/Critical set for Verification (migration 0031)')
on conflict (key, scope, version) do nothing;
