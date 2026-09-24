# GoodGuys Realtor CRM

The realtor referral pipeline as an actual app. Replaces
`GoodGuys Realtor Referral Pipeline.xlsx` as the place the team works the
call list.

**Stack:** Vite + React + TypeScript + Tailwind v4 + Supabase (Postgres, auth,
RLS). Deployed to GitHub Pages by Actions on every push to `main`.

## What it does

| Page | What it's for |
|---|---|
| **Dashboard** | Who's due, who has what, contacts against each person's weekly target, agents nobody owns, response rate, last pipeline run |
| **Call list** | The work queue — priority order, tap-to-call, tap-to-text with the template prefilled, one-tap logging |
| **Agents** | All agents, searchable and filterable; status and notes editable |
| **Brokerages** | Every firm, biggest first — click through to its agents, then narrow to one office |
| **Agent detail** | Their moves (each linked back to SmartMoving and Redfin), the call script / text / email for *that* agent, full outreach history |
| **Leads** | Every address the pipeline processed, including the recheck and manual-review buckets |
| **Cadence** | The outreach rules, with the sequence read live out of the database |
| **Run log** | Every weekly pipeline run |

## How it relates to `goodguys-pipeline`

The Python pipeline still does the weekly work — it's the half that drives
browsers (SmartMoving → Gmail → Redfin → GeorgiaMLS), and that can't be
scripted. What changed is where it writes: `push_to_crm.py` puts the run into
Postgres directly, so the CRM is no longer only as fresh as the last time
somebody imported a spreadsheet. The workbook is still written, as an export.

The division of labour is unchanged:

> **The agent drives browsers. The scripts own the data. The app is where
> the team works the results.**

Scoring, the md5-by-brokerage owner split, dedupe and the message templates
are ported into `src/lib/templates.ts` and `scripts/import_workbook.py` so
both sides produce identical output. If you change the copy in
`pipeline/messages.py`, change it here too — `src/lib/templates.test.ts`
pins the wording.

### The six columns that were yours

`Email Sent`, `Text Sent`, `Call Made`, `Call Outcome`, `Response`, `Notes`
were never written by a script, by rule. They're now the `touches` table — an
append-only log, one row per contact, stamped with who logged it. Logging a
touch automatically sets `last_touch` and schedules `next_touch_due`
`settings.follow_up_days` out (30 by default, once `REPEAT_TOUCH_COOLOFF_DAYS`
in code), which is what drives the call list.

## Setup

### 1. Database

Supabase project **`goodguys-realtor-crm`** (`qqkrfvrbbkcwigbjtqpp`).

```bash
supabase link --project-ref qqkrfvrbbkcwigbjtqpp
supabase db push --linked --dry-run    # names the migrations it would apply
supabase db push --linked
```

> **The CLI is the way in now.** This used to say migrations were applied by
> pasting into the SQL Editor and that the remote had no migration history, so
> a `db push` would try to re-run `0001` against live data. The history table
> has since been filled in — `supabase migration list` shows Local and Remote
> matching through `0014` — so no `migration repair` is needed and `db push`
> applies only what is actually missing. Dry-run first anyway; it prints the
> list.
>
> The app is deployed by Actions on a push to `main` and the SQL is run by
> hand, so **run the migration first**. Anything reading a table that isn't
> there yet says "waiting on migration …" and leaves the rest of the page
> working (`isMissingSchema` in `src/lib/supabase.ts`), but there's no reason
> to make anyone look at that.

Then **Authentication → Providers → Email**: turn on email, and turn *off*
"Confirm email" if you want the 6-digit code flow without a second click.

### 2. App

```bash
cp .env.example .env      # then paste the anon key from Settings -> API
bun install
bun run dev               # http://localhost:5174
```

### 3. Import the workbook (once)

> Historic, and still the way to reload from the .xlsx. The weekly run now
> writes here directly — `python scripts/push_to_crm.py` in goodguys-pipeline.

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

### Everyone gets a name

Signing in was never the restriction — reading and writing has always been open
to the whole domain. What a third employee didn't get was an *identity*: the
owner was worked out from the email local-part, matching `andrew` or `avery`
and returning null for anybody else. A null owner means no call list of your
own, and no row in `public.people` means nobody can assign you an agent even
by hand.

Since `0010`, signing in creates and links that row (`ensure_my_person()`), so
a new hire has a name, a call list and a place in the picker the first time
they open the app. `public.people.email` is the link.

- A name seeded or typed into **Settings → People** ahead of time is *claimed*
  by that login rather than duplicated, matching on the full name first and
  then on the first name alone when it's unambiguous — so `jack@` finds
  "Jack Sawyer" instead of opening a second "Jack" beside it.
- That first-name match is a guess, and Settings → People prints the email
  under each name so a wrong one is visible. Rename to fix it; renaming
  cascades and carries that person's agents along.
- The roster seeded by `0010` is Jack Sawyer, Trent Barron and Sy Lovingood,
  alongside Andrew and Avery.

**Assignment is the database's job now.** `pipeline/owners.py` hashed the
brokerage into a two-name tuple and took it modulo the tuple's length, so
adding three people would have reshuffled nearly every agent and discarded
everything claimed by hand. `pick_owner_for()` (migration `0011`) decides
instead, and only ever for a row that has no owner:

1. `settings.default_owner`, if one is set;
2. whoever already works that brokerage — one firm, one relationship, one
   person, which is the part of the old split worth keeping;
3. whoever is carrying the fewest agents.

The weekly run never sends `owner_name` at all. **Deal them out** on the
dashboard runs the same rule over the ownerless pile.

### My agents

`owner_name` is who works an agent; it is a filter, not a boundary, and
everyone can still see and edit everything.

- **Agents → My agents**, or the owner filter, which also has **Unassigned**.
  The filter lives in the URL, so `/agents?owner=Trent%20Barron` is a link you
  can send someone.
- Tick rows and **Assign to me**, assign to somebody else, or unassign — one
  statement for the batch.
- The dashboard draws a bar per person, and flags active agents nobody owns.
  That number used to be structurally zero; now that agents can be handed back
  it's the one that says work is falling through.
- `agents.owner_assigned_at` / `owner_assigned_by` record who took an agent and
  when, stamped by a trigger so a change made from a script or the SQL editor
  leaves the same trail as one made by clicking. Both are null for the original
  import, which the agent page reports as "from the original split by
  brokerage" rather than inventing a person.

## Contacts per week

Each person has a number of contacts they are working to, and the dashboard
says how everyone is tracking against theirs.

- **Settings → People** holds a **team default** and a per-person override.
  Blank means "use the team default" — an absent override, not a target of
  zero, so a new hire inherits a real number instead of reading as perfectly
  on track for doing nothing. Targets save as you leave the box.
- **Dashboard → Contacts this week** draws a bar each: logged against target,
  how many to go, the month to date, and an **overdue** badge.

The bar and the badge are deliberately different measurements. The bar is
*this week's effort*. The badge is *the backlog* — agents whose
`next_touch_due` has already passed. Somebody with a big book can hit their
number every week and still fall further behind, and that pair is the only way
to see it.

Weeks run Monday to Sunday in **America/New_York**, not UTC — on UTC a touch
logged at 8pm on a Sunday lands in the following week. The zone is named once,
in `contact_scoreboard`.

### What counts as a contact

Every channel except `note`: **call, text, email, letter, meeting**. A note
records something about an agent rather than reaching them, and a target that
could be met without contacting anybody would not be worth having.
`public.is_contact_channel()` is the rule; `CONTACT_CHANNELS` in
`src/lib/types.ts` mirrors it and `src/lib/channels.test.ts` pins the two
together.

> **`letter` is new in `0015`.** Post was always outreach and just had nowhere
> to go. It is a channel on the touch log, not a step in the intro sequence —
> rule 1 is still text → call → email.

Touches count toward whoever **logged** them, not whoever owns the agent:
covering for a teammate should land on the week of the person who made the
call.

> **One seam worth knowing about.** `recompute_touch_schedule()` still counts
> *every* touch when advancing the intro sequence, so a note moves an agent
> along even though it does not count toward a target. Two definitions of "a
> contact", on purpose — narrowing the cadence's would re-derive the schedule
> for every agent already in the book, which is a bigger decision than `0015`
> should make on its own.

## The outreach cadence

**Read it in the app: `/cadence`.** That page renders the sequence from
`public.outreach_steps` and the gaps from `public.settings`, so it can't
quietly disagree with what the database is doing. Each rule is marked
**Automatic** — something holds you to it — or **On you**, meaning nothing
does. Rule 6 is the only one left on you.

`recompute_touch_schedule()` (migration `0011`) is the engine. It is the one
place that answers *when is this agent next due, and what do they owe*, and
both the touch trigger and `reschedule_follow_ups()` call it.

- **Mid-sequence**, the next step is due `day_offset` days after the **first**
  touch, not the last — so a call made late doesn't push the email out behind
  it. The step is derived from the touch count rather than incremented, so
  deleting a touch corrects the sequence instead of stranding it.
- **A full sequence with no reply** sets `Attempted — no response` and rests
  the agent for `settings.no_response_pause_days`. A reply pulls them straight
  back out: the pause is a pause, not a verdict.
- **Partners and live conversations** are never put on the sequence at all,
  which is rule 6 — `in_intro_sequence()` lists the two statuses it applies to.
- The call list shows the owed step (*Step 2 · Call — day 4*) and makes that
  channel the primary button, which is rule 4 as a layout: one channel per
  touch, so one button.

The rules below were footnotes at the bottom of the workbook's Outreach
Tracker sheet, typed into the `Agent Name` column — which is how eight of them
ended up in `public.agents` as if they were realtors. `0006` moves them out.
This is the reference copy; `src/lib/cadence.ts` is the one the app renders,
and `src/lib/cadence.test.ts` pins the day-1/4/7 re-indexing.

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
- **EXECUTE is granted to PUBLIC by default.** `grant execute ... to
  authenticated` on a new function restricts nothing — it names a role that
  already had the right through PUBLIC, which `anon` belongs to. On a
  `security definer` function that means anyone holding the anon key, which is
  in the bundle by design, can call it with RLS switched off. `0014` revokes it
  on every definer function by name and guards the ones the app calls with
  `is_goodguys()`.

  `0014` also tried to make that automatic with `alter default privileges ...
  revoke execute on functions from public`, **and that does not work here** —
  Supabase keeps a `pg_default_acl` entry granting EXECUTE to `anon` by name,
  which a revoke from `PUBLIC` leaves standing. `0015` reintroduced an
  anon-callable function within one migration of the claim. So the rule is
  manual and stated once: **a new `security definer` function gets its own
  `revoke all on function <sig> from public, anon;` and its own guard.**
  `0016` ends with an assertion over `pg_proc` that fails the next `db push`
  if any definer function in `public` is executable by `anon`, which is the
  part that actually holds the line.
- **Deep links need `404.html`.** Pages has no SPA rewrite; the workflow
  copies `index.html` over so a refresh on `/agents/<id>` works.

```bash
bun run typecheck
bun run test
bun run build
```
