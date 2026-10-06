-- Fix order_alerts (0002): both elapsed_minutes and time_alert were computed only against
-- assigned_time, the Picking phase's own start point. Once an order moves on to
-- picker_completed_100/picker_completed_short (awaiting Admin Verification), that formula freezes:
-- elapsed_minutes stops advancing (its end point, picker_completed_time, is now fixed) instead of
-- measuring how long it's actually been sitting in the Verification queue, and time_alert's CASE
-- only matches status in ('assigned', 'in_progress') so it falls through to null forever -- a
-- Verification-pending order can wait any amount of time and never show warning/overdue/critical.
-- This under-reported elapsed time and silently suppressed the alert on Pending Action Monitor,
-- the Operations Dashboard's Critical/Overdue KPIs and Action Required panel, Control Tower, and
-- Zone Dashboard, all of which read time_alert/elapsed_minutes from this view -- while Admin
-- Verification's own board separately (and correctly) computes its "wait" straight from
-- picker_completed_time, which is why the two pages disagreed.
--
-- Fix: each phase now measures elapsed time from its OWN current pending step's start point
-- (assigned_time while picking, picker_completed_time while awaiting verification) against the
-- same 45/60/120-minute thresholds, instead of always anchoring to assigned_time.
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
  case
    when o.status in ('assigned', 'in_progress') and o.assigned_time is not null then
      case
        when now() - o.assigned_time >= interval '120 minutes' then 'critical'
        when now() - o.assigned_time >= interval '60 minutes' then 'overdue'
        when now() - o.assigned_time >= interval '45 minutes' then 'warning'
        else null
      end
    when o.status in ('picker_completed_100', 'picker_completed_short') and o.picker_completed_time is not null then
      case
        when now() - o.picker_completed_time >= interval '120 minutes' then 'critical'
        when now() - o.picker_completed_time >= interval '60 minutes' then 'overdue'
        when now() - o.picker_completed_time >= interval '45 minutes' then 'warning'
        else null
      end
    else null
  end as time_alert,
  case when o.status in ('assigned', 'in_progress') and current_date > o.original_order_date
    then true else false end as is_picking_backlog,
  case when o.status in ('picker_completed_100', 'picker_completed_short')
    then true else false end as is_verification_backlog
from orders o;

comment on view order_alerts is
  'Derived Warning/Overdue/Critical/Backlog conditions per §13. Each phase (Picking vs awaiting '
  'Verification) measures elapsed time from its own current step''s start point -- see migration '
  '0030. Thresholds (45/60/120 min) are illustrative defaults matching the mockups -- move to '
  '`configuration` (key=order_sla_minutes) before UAT; not yet wired to the configuration table.';
