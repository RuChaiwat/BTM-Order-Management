-- Reporting a pack problem pauses the order instead of ending it (client rule):
--   * the session that reported it stays result = 'issue' and is NOT counted in productivity
--     while the Pack Supervisor investigates;
--   * Admin closes it himself    -> result 'issue_closed'  : counted, time up to the report, pieces
--                                    minus the reported pieces;
--   * Admin sends it back to pack -> result 'issue_returned': not counted; its time is carried into
--                                    the next pack session of the order (carried_seconds), and
--                                    whoever finishes that session gets the whole order and the
--                                    whole time.
-- resumed_from points a carried session at the paused session it continues.

alter table pack_sessions add column if not exists carried_seconds integer not null default 0;
alter table pack_sessions add column if not exists resumed_from uuid references pack_sessions(session_id);

alter table pack_sessions drop constraint if exists pack_sessions_result_check;

-- History stays as it was counted: problems already resolved before this change were credited
-- (pieces minus reported pieces), which is exactly what 'issue_closed' means.
update pack_sessions ps
set result = 'issue_closed'
from pack_issues pi
where pi.session_id = ps.session_id and pi.status = 'resolved' and ps.result = 'issue';

alter table pack_sessions
  add constraint pack_sessions_result_check
  check (result in ('completed', 'completed_short', 'issue', 'issue_closed', 'issue_returned', 'cancelled'));
