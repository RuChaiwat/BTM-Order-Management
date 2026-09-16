-- Weekly auto-computed Picker Productivity rating (Business request): a 5-level, color-coded
-- read-only rating shown in Picker Management and at Work Assignment's picker-ID scan, computed
-- from each picker's ALL-TIME average pcs/hour (not just the past week) -- "blank/gray" is
-- specifically meant to mean "no productivity history yet" (a brand-new picker), which only an
-- all-time average can express; a rolling 7-day window would also go blank for an experienced
-- picker who simply didn't work last week. Recomputed every Sunday by
-- /api/cron/picker-productivity (vercel.json), never editable by Admin.

insert into configuration (key, value, scope, effective_date, version, active, change_reason)
values ('picker_productivity.target_pcs_per_hour', '4500', 'global', current_date, 1, true, 'Initial seed for weekly Picker Productivity rating')
on conflict (key, scope, version) do nothing;

alter table pickers
  add column productivity_level text check (productivity_level in ('above_target', 'target', 'yellow', 'red')),
  add column productivity_pcs_per_hour numeric,
  add column productivity_updated_at timestamptz;

-- Does the whole aggregate-and-update in one round trip (same "compute in SQL, not JS" reasoning
-- as migrations 0014/0016/0017 this session -- also makes the update atomic across every picker
-- at once). Bands, per Business's spec:
--   > 100% of target       -> above_target (dark green)
--   80% <= pct <= 100%     -> target (green)
--   60% <= pct < 80%       -> yellow
--   < 60%                  -> red
--   no completions ever    -> null (gray, "no productivity yet")
create or replace function recompute_picker_productivity(p_target_pcs_per_hour numeric)
returns int
language plpgsql
as $$
declare
  v_count int;
begin
  with agg as (
    select
      ab.picker_id,
      sum(pc.actual_pieces) as total_pieces,
      sum(greatest(extract(epoch from (pc.picker_completed_time - o.assigned_time)) / 60, 1)) as total_minutes
    from picker_completions pc
    join orders o on o.order_id = pc.order_id
    join assignment_batches ab on ab.assignment_batch_id = o.assignment_batch_id
    where ab.picker_id is not null and o.assigned_time is not null
    group by ab.picker_id
  ), rated as (
    select
      p.picker_id,
      case when agg.total_minutes > 0 then round((agg.total_pieces / agg.total_minutes) * 60) else null end as pcs_per_hour,
      case
        when agg.total_minutes is null or agg.total_minutes = 0 then null
        when (agg.total_pieces / agg.total_minutes * 60) / p_target_pcs_per_hour * 100 > 100 then 'above_target'
        when (agg.total_pieces / agg.total_minutes * 60) / p_target_pcs_per_hour * 100 >= 80 then 'target'
        when (agg.total_pieces / agg.total_minutes * 60) / p_target_pcs_per_hour * 100 >= 60 then 'yellow'
        else 'red'
      end as level
    from pickers p
    left join agg on agg.picker_id = p.picker_id
    where p.active = true
  )
  update pickers p
  set productivity_pcs_per_hour = rated.pcs_per_hour,
      productivity_level = rated.level,
      productivity_updated_at = now()
  from rated
  where rated.picker_id = p.picker_id;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function recompute_picker_productivity(numeric) to authenticated, service_role;
