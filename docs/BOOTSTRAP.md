# First-time setup: creating the first System Admin

The app has no self-signup — users are provisioned by a System Admin (§7). That's a
chicken-and-egg problem for the very first user, so bootstrap it manually once:

1. **Supabase Dashboard → Authentication → Users → Add user.** Create yourself with an
   email + password (or "Send invite" if you'd rather set the password via email link).
   Copy the generated **User UID**.
2. **Supabase Dashboard → SQL Editor**, run (replace the values):

   ```sql
   insert into employees_users (user_id, auth_user_id, name_en, name_th, email, role, warehouse_code)
   values ('U0001', '<paste the User UID from step 1>', 'Your Name', null, 'you@example.com', 'system_admin', 'DC002');
   ```

3. Sign in at `/login` with that email/password — you should land on the Operations Dashboard
   with the full 15-item menu (System Admin sees everything, per `src/lib/roles.ts`).

Every subsequent user is created from the app's **User Management** screen (§7, §17), which
calls `/api/users` — that route uses the Supabase Auth Admin API (service_role key) to create
the `auth.users` row and the matching `employees_users` row in one step, so no one else needs
this manual dance.
