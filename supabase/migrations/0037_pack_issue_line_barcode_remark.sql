-- Pack issue lines: per-barcode comment + scanned barcode (for items not in the TO).
-- Additive only; existing rows keep NULL.
alter table pack_issue_lines add column if not exists barcode text;
alter table pack_issue_lines add column if not exists remark text;
