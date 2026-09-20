-- Pick Completion / Admin Verification redesign: the picker now only reports a coarse result
-- (Completed / Completed with Short) with no per-line quantity or reason -- that detail moves to
-- Admin Verification, entered against the real WMS confirmation. actual_pieces is therefore
-- unknown at picker-submission time for a short completion (only known once Admin enters it), so
-- it can no longer be NOT NULL.
alter table picker_completions alter column actual_pieces drop not null;
