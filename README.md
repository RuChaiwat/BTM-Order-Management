# BTM Order Management

Beautrium Order Management System — Order Consolidation + Order Picking Productivity, per the
v1.2 Business & System Requirement Specification (`project/uploads/req.txt` and the chat history
under `chats/` document how the UI mockups were derived from it).

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth) · deployed on Vercel.

## Status

This is under active development. Built so far:

- Full Postgres schema + RLS policies (`supabase/migrations/`) — see `0001_init_schema.sql` for
  design notes on two judgment calls made where the requirement is ambiguous.
- Next.js scaffold with real Supabase Auth (`app/login`), session middleware, role-based
  navigation derived from §7/§15 of the requirement (`src/lib/roles.ts`).
- The reference UI (`project/Warehouse OMS.dc.html`) — the Claude Design mockups this build
  implements pixel-for-pixel where the requirement doesn't override them.

Not yet wired to real data: Order import, Location Master, the Picking Productivity screens
(currently rendering mock data), the Order Consolidation matching engine, and the weekly Google
Sheets export / retention purge jobs.

## Local development

```bash
npm install
cp .env.local.example .env.local   # fill in Supabase project URL + keys
npm run dev
```

## Database

Apply the migrations in `supabase/migrations/` in order (via `supabase db push` once the
Supabase CLI is linked to your project, or by pasting each file into the Supabase SQL editor).

## Deployment

Import this repo on [vercel.com](https://vercel.com), set the environment variables listed in
`.env.local.example` under Project Settings → Environment Variables, and deploy.
