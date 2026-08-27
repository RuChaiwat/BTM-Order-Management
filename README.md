# BTM Order Management

Beautrium Order Management System — Order Consolidation + Order Picking Productivity, per the
v1.2 Business & System Requirement Specification (`project/uploads/req.txt` and the chat history
under `chats/` document how the UI mockups were derived from it).

**Stack:** Next.js 14 (App Router) · Supabase (Postgres + Auth) · deployed on Vercel.

## Status

All 33 functional requirements have a working implementation:

- **Shared Order Core** — Supabase Auth + role-based menu/action permission (`src/lib/roles.ts`,
  `src/lib/auth.ts`), WMS order import (`/orders`, `/api/imports/orders`), Location Master
  (`/locations`, `/api/imports/locations`), effective-dated Configuration and a maintainable
  Reason Master (`/admin`), audit logging on every write (`src/lib/audit.ts`).
- **Order Picking Productivity** — Operations Dashboard, Control Tower, Work Assignment (List
  Selection + Barcode Scan, FR-030 single-Zone/single-Warehouse confinement enforced by a DB
  trigger), Admin Verification (Final Close / Reject), order Cancel (FR-028/029), User
  Management — all six screens on real Supabase data.
- **Order Consolidation** — a real, unit-tested §10 matching engine (`src/lib/matching/engine.ts`)
  doing exact-signature P1 clustering, inverted-index P2-P4 candidate search, and
  Maximum-Stores batch splitting; Matching Dashboard + Batch Review (`/matching`), Consolidation
  History (`/consolidation-history`), and an A4 Consolidated Pick Report with Code128 Bin/SKU
  barcodes (`/pick-report/[batchId]`).
- **Housekeeping (§20)** — weekly Google Sheets productivity export and the 7-day retention purge
  (export-gated, per §20.2), both as Vercel Cron jobs with a manual trigger + run history on
  `/admin`.

Full Postgres schema + RLS policies are in `supabase/migrations/` — `0001_init_schema.sql`'s
header comment documents the judgment calls made where the requirement is ambiguous (multi-zone
order assignment, status-column modeling for "Waiting Admin Verification").

**What's genuinely unverified**: this was built without live Supabase/Google API access from the
build environment. The matching engine was checked with a standalone test script (exact-match
clustering, max-SKU exclusion, store-capacity splitting all pass); everything else is verified
only by `tsc --noEmit` and a clean `next build`, not by exercising it against real data or the
real Google Sheets API. The retention purge job especially — review it carefully, consider a
staging dry run, before trusting the cron schedule with it.

**Not built**: PDA picker execution screens (the source design mockups explicitly scoped these
out — "try next: add the PDA picker execution screens" — so picker completion is admin-triggered
from a "Picker Monitor (quick action)" panel on `/verification` rather than a dedicated picker
UI), the Picking Slip mockup/layout (Appendix D open item — no reference from Business yet), and
fine-grained per-module ADM/SUP/PLN/ZC/PCK/VW permission matrix enforcement (menu-level RBAC is
real; the visual permission matrix from the original mockup was documented as a v1 simplification
in `supabase/migrations/0002_rls_and_views.sql`).

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
`.env.local.example` under Project Settings → Environment Variables, and deploy. The two cron
jobs in `vercel.json` need `CRON_SECRET` set, and the weekly export additionally needs
`GOOGLE_SERVICE_ACCOUNT_JSON` + `GOOGLE_DRIVE_FOLDER_ID`.

## First-time setup

See `docs/BOOTSTRAP.md` for creating the first System Admin user.
