# GoodGuys Realtor CRM

The realtor referral pipeline as an actual app. Replaces
`GoodGuys Realtor Referral Pipeline.xlsx` as the place Andrew and Avery
work the call list.

**Stack:** Vite + React + TypeScript + Tailwind v4 + Supabase (Postgres, auth,
RLS). Deployed to GitHub Pages by Actions on every push to `main`.

## What it does

| Page | What it's for |
|---|---|
| **Dashboard** | Who's due, the Andrew/Avery split, response rate, last pipeline run |
| **Call list** | The work queue — priority order, tap-to-call, tap-to-text with the template prefilled, one-tap logging |
| **Agents** | All agents, searchable and filterable; status and notes editable |
| **Agent detail** | Their moves, the call script / text / email for *that* agent, full outreach history |
| **Leads** | Every address the pipeline processed, including the recheck and manual-review buckets |
| **Run log** | Every weekly pipeline run |

## How it relates to `goodguys-pipeline`

The Python pipeline still does the weekly work — it's the half that drives
browsers (SmartMoving → Gmail → Redfin → GeorgiaMLS), and that can't be
scripted. What changes is where it writes: the CRM database instead of the
workbook.

The division of labour is unchanged:

> **The agent drives browsers. The scripts own the data. The app is where
> Andrew and Avery work the results.**

Scoring, the md5-by-brokerage owner split, dedupe and the message templates
are ported into `src/lib/templates.ts` and `scripts/import_workbook.py` so
both sides produce identical output. If you change the copy in
`pipeline/messages.py`, change it here too — `src/lib/templates.test.ts`
pins the wording.

### The six columns that were yours

`Email Sent`, `Text Sent`, `Call Made`, `Call Outcome`, `Response`, `Notes`
were never written by a script, by rule. They're now the `touches` table — an
append-only log, one row per contact, stamped with who logged it. Logging a
touch automatically sets `last_touch` and schedules `next_touch_due` 30 days
out (`REPEAT_TOUCH_COOLOFF_DAYS`), which is what drives the call list.

## Setup

### 1. Database

Supabase project **`goodguys-realtor-crm`** (`qqkrfvrbbkcwigbjtqpp`).

Paste `supabase/migrations/0001_init.sql` into the SQL Editor and run it.

Then **Authentication → Providers → Email**: turn on email, and turn *off*
"Confirm email" if you want the 6-digit code flow without a second click.

### 2. App

```bash
cp .env.example .env      # then paste the anon key from Settings -> API
bun install
bun run dev               # http://localhost:5174
```

### 3. Import the workbook (once)

```bash
set SUPABASE_URL=https://qqkrfvrbbkcwigbjtqpp.supabase.co
set SUPABASE_SERVICE_KEY=<service_role key>
python scripts/import_workbook.py --dry-run   # check the counts first
python scripts/import_workbook.py
```

Idempotent — every table upserts on a natural key, so re-running updates
rather than duplicates. The `service_role` key bypasses RLS, which a bulk
import needs; it is **not** the anon key and must never reach the browser or
git.

### 4. Deploy

Set two repository secrets (Settings → Secrets and variables → Actions):

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Then Settings → Pages → Source: **GitHub Actions**. Push to `main` and it
builds, typechecks, tests and deploys.

> GitHub Pages from a **private** repo needs GitHub Pro. On a free plan
> either make the repo public — the anon key is designed to be public and RLS
> is what actually protects the data — or point the repo at Cloudflare Pages,
> which serves private repos free.

## Access

Anyone with a `@goodguysserve.com` address can sign in with an emailed code.
No invites to manage.

That rule lives in `public.is_goodguys()` and every RLS policy calls it, so
it's enforced in the database, not in the UI. The check in
`src/lib/supabase.ts` only exists to give a clear error instead of an
inexplicably empty app.

Andrew and Avery are auto-mapped to their half of the split on first sign-in
(by email local-part). Anyone else gets full access with no default filter.

## Notes

- **Priority tops out at 90, not 100.** The four components are 30 + 25 + 25 +
  10. Inherited from the pipeline; the UI bands it high/medium/low.
- **`TBD — lookup` never dials.** `dialable()` returns null for placeholders
  and short numbers, so the call button doesn't appear. Never invent a phone.
- **Ownership is a filter, not a boundary.** Both of you can see and edit
  everything; the split just decides whose call list is whose.
- **Touches can be deleted only by the person who logged them** — history gets
  corrected, not quietly erased.
- **Deep links need `404.html`.** Pages has no SPA rewrite; the workflow
  copies `index.html` over so a refresh on `/agents/<id>` works.

```bash
bun run typecheck
bun run test
bun run build
```
