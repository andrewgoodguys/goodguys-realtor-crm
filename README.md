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
| **Brokerages** | Every firm, biggest first — click through to its agents, then narrow to one office |
| **Agent detail** | Their moves (each linked back to SmartMoving and Redfin), the call script / text / email for *that* agent, full outreach history |
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

### 4. SmartMoving deep links (once, then after each import)

The "Their moves we did" list links each move back to its SmartMoving page.
That link needs the **opportunity** GUID, which the All Jobs export does not
contain and cannot be made to contain — the report has parameters but no column
picker. It comes from the Open API instead, keyed on the quote number:
`job_number` is `{quote}-{seq}`, so `1981-1` is job 1 of quote 1981.

Turn the API on at **Settings → Integrations → SmartMoving API** in
SmartMoving, then:

```bash
set SMARTMOVING_API_KEY=<the key it shows you>
python scripts/backfill_sm_opportunity_ids.py --probe    # one quote, writes nothing
python scripts/backfill_sm_opportunity_ids.py
```

Start with `--probe`. It resolves a single quote and prints the link it would
build, which is the cheapest way to find out whether the base URL and headers
are right for this tenant before making several hundred requests. If the key is
rejected, the script says so and names the two environment variables that might
be missing (`SMARTMOVING_SUBSCRIPTION_KEY`, `SMARTMOVING_BASE_URL`).

Resumable: it only asks about jobs whose `sm_opportunity_id` is still null, so
rerun it after every workbook import to pick up the new jobs, and an
interrupted run just carries on. One request per quote, not per job.

A job with no opportunity id shows no SmartMoving link — `smartMovingLink()`
returns null rather than guessing, because a guessed link lands on "The
specified opportunity was not found."

### 4b. Split brokerage from office (once)

The workbook keeps the branch inside the brokerage name, so the CRM has 71
distinct brokerage strings for 49 firms — thirteen of them Keller Williams
market centers filed as thirteen separate companies. `scripts/brokerages.py`
splits them; `split_brokerage_offices.py` applies that to the agents already in
the database.

```bash
python scripts/split_brokerage_offices.py --dry-run
python scripts/split_brokerage_offices.py
```

**It reassigns agents between Andrew and Avery**, because `owner_for_brokerage()`
hashes the brokerage and the brokerage is what changes. That is the intended
effect — one firm now hashes to one bucket instead of thirteen — but read the
`--dry-run` report first; it prints the before and after counts. Pass
`--keep-owners` to split the names without touching ownership.

It never overwrites an office that is already filled in: a value typed on the
agent page beats one parsed out of a brokerage string.

`import_workbook.py` applies the same split, so later imports stay consistent.

### 5. Deploy

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

## The outreach cadence

The rules below were footnotes at the bottom of the workbook's Outreach
Tracker sheet, typed into the `Agent Name` column — which is how eight of them
ended up in `public.agents` as if they were realtors. `0006` moves them out.
This is now the place they are written down.

> 1. **Intro sequence per agent, ONCE ever:** Text (day 1) → Call (day 4) →
>    Email (day 7).
> 2. No response after the full sequence → status "Attempted — no response."
>    Wait 90 days before any new touch.
> 3. Agent appears on a NEW closed job → one congratulatory touch only, and
>    only if last touch was 30+ days ago.
> 4. One channel per touch. Never call, text, AND email on the same day.
> 5. "DO NOT CONTACT" status is permanent — weekly runs skip these agents
>    automatically.
> 6. In conversation / partner agents: relationship-driven contact only, no
>    templates.
> 7. Priority Score and "Contact This Week" are set by the weekly run — top 20
>    uncontacted agents.

Rule 1 is the only one shaped like a sequence, and it lives in
`public.outreach_steps` as three rows. `day_offset` counts days *after* the
first touch, so day 1/4/7 is stored as 0/3/6. The step rows carry no copy —
the wording is in `public.settings`, in one place.

Rules 2–7 are policy, and each is already enforced somewhere:
`settings.follow_up_days` and `sync_agent_touch()` for the gaps,
one `touches` row per contact for rule 4, `agents.do_not_contact` for rule 5,
`relationship_status` for rule 6, and `agents.priority` plus the call list for
rule 7.

## Notes

- **Priority tops out at 90, not 100.** The four components are 30 + 25 + 25 +
  10. Inherited from the pipeline; the UI bands it high/medium/low.
- **`TBD — lookup` never dials.** `dialable()` returns null for placeholders
  and short numbers, so the call button doesn't appear. Never invent a phone.
- **Office is deliberately not part of brokerage.** `brokerage` feeds the
  ownership hash, so the branch lives in its own column — see `0004`. The split
  is conservative: a tail only becomes an office when the string opens with a
  franchise brand we recognise, so "Keller Williams Realty Peachtree Rd." splits
  and "Candler Real Estate Group, LLC" is left whole.
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
