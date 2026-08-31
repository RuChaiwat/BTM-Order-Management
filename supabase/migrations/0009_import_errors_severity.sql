-- §5.2 import feedback UX fix: users had no way to tell which import errors mean the row was
-- skipped and must be fixed + re-uploaded ("blocking") vs. which mean the row imported anyway and
-- can be left as-is ("warning", e.g. Invalid Bin Code — the order/line is created regardless,
-- only Zone/Pick Sequence end up empty). Existing rows default to 'blocking' since that was the
-- de-facto behavior before this migration (every row in import_errors was, in practice, either a
-- true blocker or a bin-code warning — defaulting to the stricter label is the safe choice for
-- data we can no longer distinguish after the fact).
alter table import_errors add column severity text not null default 'blocking' check (severity in ('blocking', 'warning'));
