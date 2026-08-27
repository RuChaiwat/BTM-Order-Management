-- Bug fix: audit_logs.entity_id (and status_history.entity_id, same issue) was `uuid`, but
-- employees_users and reason_master use text natural keys (e.g. 'U0001', 'DAMAGED') as their
-- entity_id when audited — those inserts would fail against a uuid column. Widen to text;
-- existing uuid values cast losslessly.
alter table audit_logs alter column entity_id type text using entity_id::text;
alter table status_history alter column entity_id type text using entity_id::text;
