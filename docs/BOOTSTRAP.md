# First-time setup: creating the first System Admin

The app has no self-signup — users are provisioned by a System Admin (§7). That's a
chicken-and-egg problem for the very first user, so bootstrap it manually once.

Login is by **User ID** (max 10 characters), not email — real email is optional contact info
only. Under the hood, Supabase Auth still needs an email/password pair, so each user gets a
synthetic, internal-only address derived from their User ID: `<user_id lowercased>@user.btm-oms.example`
(see `src/lib/authEmail.ts`). You need that exact derived address for this manual step —
every subsequent user created from the app does this automatically.

1. **Supabase Dashboard → Authentication → Users → Add user.** For User ID `U0001`, create a
   user with email **`u0001@user.btm-oms.example`** (the domain is deliberately fake — `.example`
   is IANA-reserved and never resolves — so nothing tries to actually deliver mail there) and a
   password. Copy the generated **User UID**.
2. **Supabase Dashboard → SQL Editor**, run (replace the values):

   ```sql
   insert into employees_users (user_id, auth_user_id, name_en, name_th, email, role, warehouse_code)
   values ('U0001', '<paste the User UID from step 1>', 'Your Name', null, null, 'system_admin', 'DC002');
   ```

   The `email` column here is optional real contact info (can be `null` or a real address) —
   it has nothing to do with login.

3. Sign in at `/login` with **User ID `U0001`** and the password you set — you should land on the
   Operations Dashboard with the full 15-item menu (System Admin sees everything, per
   `src/lib/roles.ts`).

Every subsequent user is created from the app's **User Management** screen (§7, §17), which
calls `/api/users` — that route uses the Supabase Auth Admin API (service_role key) to derive the
synthetic email, create the `auth.users` row, and create the matching `employees_users` row in
one step, so no one else needs this manual dance.
