-- §12.2 UI rework: the picker's Pick Completion screen now itemizes short picks per order line
-- (select the short-picked item, choose a reason, enter the actual quantity) instead of a single
-- order-level reason. picker_completions stays the order-level summary row (actual_pieces/result);
-- this table adds the per-line detail feeding that summary, and is what the Admin Verification
-- and Productivity/Short-Pick screens read for reason breakdowns.

create table picker_completion_lines (
  id uuid primary key default gen_random_uuid(),
  completion_id uuid not null references picker_completions(completion_id) on delete cascade,
  line_id uuid not null references order_lines(line_id),
  ordered_qty numeric not null,
  picked_qty numeric not null,
  is_short boolean not null default false,
  short_reason_code text references reason_master(reason_code),
  remark text,
  created_at timestamptz not null default now(),
  unique (completion_id, line_id)
);
create index idx_picker_completion_lines_completion on picker_completion_lines(completion_id);
create index idx_picker_completion_lines_line on picker_completion_lines(line_id);

alter table picker_completion_lines enable row level security;

-- Mirrors the read_picker_completions policy in 0002 (same visibility as the parent row).
create policy read_picker_completion_lines on picker_completion_lines for select using (
  auth_role() in ('system_admin', 'warehouse_manager', 'supervisor', 'planner_admin', 'viewer')
  or exists (
    select 1 from picker_completions pc
    join orders o on o.order_id = pc.order_id
    join assignment_batches ab on ab.assignment_batch_id = o.assignment_batch_id
    where pc.completion_id = picker_completion_lines.completion_id and ab.picker_id = auth_business_user_id()
  )
);
