-- Packing: split "report a problem" from "Completed with Short" (2026-11 client clarification).
--
--   * แจ้งปัญหา (report issue) -- a button on the Pack Handheld's timer screen. The packer lists the
--     problem items (SKU + problem + qty); the timer stops, the order goes to pack_status 'issue'
--     and the Pack Supervisor investigates on Pack Issue Investigation. Session result = 'issue'.
--   * Completed with Short -- one of the two finish buttons after re-scanning the order. The packer
--     enters nothing; the order goes to Admin Pack Verify flagged short, where the Pack Supervisor
--     itemizes the short lines (reason from the Pick-side Short Pick reason master + actual packed
--     qty), exactly like Admin Verification on the Pick side, while confirming in WMS.
--
-- Before this migration 'completed_short' meant "reported a problem" -- those rows become 'issue'.

alter table pack_sessions drop constraint if exists pack_sessions_result_check;
update pack_sessions set result = 'issue' where result = 'completed_short';
alter table pack_sessions
  add constraint pack_sessions_result_check check (result in ('completed', 'completed_short', 'issue', 'cancelled'));

-- Pieces Admin Pack Verify recorded as short for this session's order -- excluded from the
-- packer's productivity together with issue_pieces.
alter table pack_sessions add column if not exists short_pieces int not null default 0;

-- Per-line result of Admin Pack Verify (written for every confirmation made one order at a time;
-- bulk confirmation of fully packed orders writes none -- every line is then packed in full).
create table if not exists pack_verification_lines (
  id uuid primary key default gen_random_uuid(),
  verification_id uuid not null references pack_verifications(verification_id) on delete cascade,
  line_id uuid not null references order_lines(line_id) on delete cascade,
  expected_qty numeric not null,
  packed_qty numeric not null,
  is_short boolean not null default false,
  short_reason_code text references reason_master(reason_code),
  remark text,
  created_at timestamptz not null default now()
);
create index if not exists idx_pack_verification_lines_verification on pack_verification_lines(verification_id);

alter table pack_verification_lines enable row level security;
drop policy if exists read_pack_verification_lines on pack_verification_lines;
create policy read_pack_verification_lines on pack_verification_lines for select using (auth_role() is not null);
