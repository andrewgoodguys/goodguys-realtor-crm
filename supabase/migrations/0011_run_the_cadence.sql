-- Make the cadence the thing that schedules work, and make assignment survive
-- there being more than two people.
--
-- 0006 put the intro sequence in public.outreach_steps and 0010 put the rules
-- on a page. Neither made anything happen: sync_agent_touch() has scheduled
-- every agent the same follow_up_days out since 0001, whether they are one
-- text into an introduction or five years into a relationship. The sequence
-- was data nothing read, and the call list could not tell you what to send.
--
-- Two rules were written down and enforced by nobody:
--   rule 1, the text -> call -> email sequence, days 1 / 4 / 7;
--   rule 2, the 90-day pause once a whole sequence goes unanswered.
-- Both become automatic here. /cadence marks rules from the same facts, so it
-- will stop calling them "On you" on its own.
--
-- Assignment is the other half. The md5-by-brokerage split in
-- pipeline/owners.py hashes into a fixed tuple of two names, and `% len(OWNERS)`
-- reshuffles *everything* the moment that tuple grows: going to five people
-- would reassign nearly every agent and wipe out anything claimed by hand. So
-- new agents are assigned here instead, on insert only, by a rule that never
-- disturbs a row that already has an owner.

-- ------------------------------------------------------------ rule 2's pause
alter table public.settings
  add column if not exists no_response_pause_days integer not null default 90;

alter table public.settings drop constraint if exists settings_no_response_pause_ck;
alter table public.settings add constraint settings_no_response_pause_ck
  check (no_response_pause_days between 1 and 3650);

comment on column public.settings.no_response_pause_days is
  'Rule 2: how long an agent rests after a full intro sequence went unanswered.
   Was a number in a footnote that nothing applied.';

-- ------------------------------------------------------- where in the sequence
-- Which intro step this agent owes next. Null means the sequence is done, or
-- does not apply to them — a partner, or someone resting under rule 2.
alter table public.agents
  add column if not exists next_step_number smallint;

comment on column public.agents.next_step_number is
  'The outreach_steps row this agent owes next, maintained by
   recompute_touch_schedule(). Null when the intro sequence is finished or
   does not apply. The call list reads it to name the channel and pick copy.';

-- ------------------------------------------- statuses the sequence stops for
-- Rule 6: partners and live conversations are relationship-driven, and a
-- scripted introduction is exactly the wrong thing to send them. Rule 2's
-- resting agents are excluded for a different reason and handled separately.
create or replace function public.in_intro_sequence(status text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(status, '') in ('New — not contacted', 'Contacted')
$fn$;

comment on function public.in_intro_sequence is
  'True for the two statuses the scripted introduction is meant for. Rule 6
   keeps Engaged, Referral partner and the rest out of it.';

-- ------------------------------------------------------------ the schedule
-- One implementation of "when is this agent next due, and what do they owe",
-- called by the touch trigger for one agent and by reschedule_follow_ups() for
-- all of them. Two copies of this drifting apart is how the cadence became
-- decorative in the first place.
create or replace function public.recompute_touch_schedule(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n_touches  integer;
  n_replies  integer;
  first_at   date;
  latest     date;
  n_steps    integer;
  step       record;
  gap        integer;
  pause      integer;
  status     text;
  dnc        boolean;
  new_status text;
  due        date;
  step_no    smallint := null;
begin
  select follow_up_days, no_response_pause_days
    into gap, pause
    from public.settings where id;
  gap   := coalesce(gap, 30);
  pause := coalesce(pause, 90);

  select relationship_status, do_not_contact
    into status, dnc
    from public.agents where id = target;
  if not found then
    return;
  end if;

  select count(*),
         count(*) filter (where got_response),
         min(occurred_at)::date,
         max(occurred_at)::date
    into n_touches, n_replies, first_at, latest
    from public.touches where agent_id = target;

  select count(*) into n_steps from public.outreach_steps where active;

  new_status := status;

  if dnc then
    -- Rule 5. Never scheduled, never resurrected, whatever else is true.
    due := null;

  elsif latest is null then
    -- Never touched: they owe step 1, and they are due now rather than on a
    -- date, because the sequence has no origin until the first touch lands.
    due := null;
    if n_steps > 0 and public.in_intro_sequence(status) then
      select s.step_number into step_no
        from public.outreach_steps s
       where s.active order by s.day_offset, s.step_number limit 1;
    end if;

  elsif public.in_intro_sequence(status) and n_touches < n_steps then
    -- Rule 1. Mid-sequence: the next step is due day_offset days after the
    -- *first* touch, not after the last one, so a late call does not push the
    -- email out behind it. offset by touches logged, which is what makes this
    -- survive a touch being deleted — the step is recomputed, not incremented.
    select s.step_number, s.day_offset into step
      from public.outreach_steps s
     where s.active
     order by s.day_offset, s.step_number
     offset n_touches limit 1;

    due     := first_at + step.day_offset;
    step_no := step.step_number;

  elsif public.in_intro_sequence(status)
        and n_steps > 0 and n_touches >= n_steps and n_replies = 0 then
    -- Rule 2. The whole sequence went out and nothing came back. This is the
    -- status the rule has named since the workbook and that nobody could set,
    -- because it was not in the picker until 0010's follow-up.
    new_status := 'Attempted — no response';
    due        := latest + pause;

  elsif status = 'Attempted — no response' and n_replies > 0 then
    -- They answered in the end. Rule 2 is a pause, not a verdict, and without
    -- this an agent who replies on day 100 rests for another 90 and is never
    -- heard from again.
    new_status := 'Contacted';
    due        := latest + gap;

  elsif status = 'Attempted — no response' then
    due := latest + pause;

  else
    -- Everyone else — partners, conversations, finished sequences that did get
    -- a reply — on the ordinary cool-off. Rule 3's congratulatory touch is
    -- this branch: it is what makes a repeat agent come back around.
    due := latest + gap;
  end if;

  update public.agents
     set last_touch       = latest,
         next_touch_due   = due,
         next_step_number = step_no,
         relationship_status = case
           when new_status <> status then new_status
           when latest is null then 'New — not contacted'
           when relationship_status = 'New — not contacted' then 'Contacted'
           else relationship_status
         end,
         updated_at = now()
   where id = target;
end;
$fn$;

-- The trigger is now a two-line wrapper. Everything it used to do inline is
-- above, where reschedule_follow_ups() can reach it too.
create or replace function public.sync_agent_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  perform public.recompute_touch_schedule(coalesce(new.agent_id, old.agent_id));
  return null;
end;
$fn$;

-- Changing the cadence should move every open follow-up, not only the next one
-- logged — and now it also re-derives which step everyone is on, which is what
-- backfills next_step_number for the agents that already exist.
create or replace function public.reschedule_follow_ups()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  a uuid;
begin
  for a in select id from public.agents loop
    perform public.recompute_touch_schedule(a);
  end loop;
end;
$fn$;

-- An agent's schedule also changes when their status does — marking someone a
-- referral partner should take them out of the scripted sequence immediately,
-- not at their next touch.
create or replace function public.resync_on_status_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  -- pg_trigger_depth() = 1 is load-bearing, not a nicety.
  -- recompute_touch_schedule() ends in an UPDATE on public.agents, and that
  -- update can itself change relationship_status (New — not contacted ->
  -- Contacted, or rule 2's status). Without the depth guard this trigger fires
  -- on its own write, sees the status it just changed, and recurses until the
  -- stack limit. At depth > 1 the recompute has, by definition, just run.
  if pg_trigger_depth() = 1
     and (new.relationship_status is distinct from old.relationship_status
          or new.do_not_contact is distinct from old.do_not_contact) then
    perform public.recompute_touch_schedule(new.id);
  end if;
  return null;
end;
$fn$;

drop trigger if exists agents_resync_schedule on public.agents;
create trigger agents_resync_schedule after update on public.agents
  for each row execute function public.resync_on_status_change();

-- ---------------------------------------------------------------- assignment
-- Who a *new* agent goes to. Never consulted for an agent that already has an
-- owner, which is the whole point: the md5 split reassigned everybody whenever
-- the roster changed, and assignment now lives in the app where people claim
-- their own work.
--
-- Brokerage first, because that is the part of the old split worth keeping —
-- one firm, one relationship, one person who knows them. Least-loaded only
-- decides genuinely new firms.
create or replace function public.pick_owner_for(brokerage_name text)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  chosen text;
begin
  -- An explicit choice in Settings wins over any rule.
  select default_owner into chosen from public.settings where id;
  if chosen is not null then
    return chosen;
  end if;

  -- Whoever already works this firm. Most agents there wins; ties break on the
  -- roster order so the result does not depend on row order.
  if coalesce(brokerage_name, '') <> '' then
    select a.owner_name into chosen
      from public.agents a
      join public.people p on p.name = a.owner_name and p.active
     where a.brokerage = brokerage_name
       and a.owner_name is not null
     group by a.owner_name
     order by count(*) desc, min(p.sort_order)
     limit 1;
    if chosen is not null then
      return chosen;
    end if;
  end if;

  -- A firm nobody works yet: give it to whoever is carrying the least.
  select p.name into chosen
    from public.people p
    left join public.agents a
      on a.owner_name = p.name and not a.do_not_contact
   where p.active
   group by p.name, p.sort_order
   order by count(a.id), p.sort_order
   limit 1;

  return chosen;
end;
$fn$;

comment on function public.pick_owner_for is
  'Owner for a NEW agent: the Settings default, else whoever already works that
   brokerage, else the person carrying the fewest agents. Never reassigns.';

create or replace function public.assign_new_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.owner_name is null then
    new.owner_name := public.pick_owner_for(new.brokerage);
  end if;
  return new;
end;
$fn$;

drop trigger if exists agents_assign_owner on public.agents;
create trigger agents_assign_owner before insert on public.agents
  for each row execute function public.assign_new_agent();

-- The unassigned pile, dealt out by the same rule. Row by row rather than in
-- one statement, because least-loaded has to see the effect of the previous
-- assignment — a set-based version gives every agent to the same person.
create or replace function public.distribute_unassigned()
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  r     record;
  who   text;
  moved integer := 0;
begin
  if not public.is_goodguys() then
    raise exception 'Not a GoodGuys account.';
  end if;

  for r in
    select id, brokerage from public.agents
     where owner_name is null and not do_not_contact
     order by priority desc, name
  loop
    who := public.pick_owner_for(r.brokerage);
    exit when who is null;           -- nobody active to receive them
    update public.agents set owner_name = who where id = r.id;
    moved := moved + 1;
  end loop;

  return moved;
end;
$fn$;

comment on function public.distribute_unassigned is
  'Hand every ownerless active agent to somebody, brokerage-first. Returns how
   many moved. Safe to run twice — the second run finds nothing.';

grant execute on function public.distribute_unassigned() to authenticated;
grant execute on function public.reschedule_follow_ups() to authenticated;

-- ------------------------------------------------------------------ backfill
-- next_step_number is null on every existing row, and last_touch/next_touch_due
-- were computed by the old rule. One pass puts every agent on the new schedule
-- and moves anyone whose sequence has already gone unanswered onto rule 2.
do $do$
declare
  moved integer;
begin
  perform public.reschedule_follow_ups();

  select count(*) into moved
    from public.agents where relationship_status = 'Attempted — no response';
  raise notice 'Schedule recomputed; % agent(s) now resting under rule 2.', moved;
end
$do$;
