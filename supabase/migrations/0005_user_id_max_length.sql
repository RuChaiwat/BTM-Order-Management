-- Login is now by User ID (max 10 chars, src/lib/authEmail.ts) rather than email — enforce the
-- length at the DB layer too, not just in application code.
alter table employees_users
  add constraint chk_employees_users_user_id_length check (char_length(user_id) <= 10);
