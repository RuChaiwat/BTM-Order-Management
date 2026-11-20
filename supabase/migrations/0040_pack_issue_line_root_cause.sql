-- Pack Issue Investigation: Admin records the real cause per reported item instead of one cause
-- for the whole issue. pack_issues.root_cause stays and holds the main cause (the one with the
-- most pieces) for the Handheld note and older reports. Additive only; existing rows keep NULL.
alter table pack_issue_lines add column if not exists root_cause text;
