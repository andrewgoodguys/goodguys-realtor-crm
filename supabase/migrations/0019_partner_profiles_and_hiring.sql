-- Partners get a profile, and a new kind of contact: hiring partners.
--
-- Two things, which share one change to `touches`:
--
--   1. Partners (0017) could be claimed but not worked — there was nowhere to
--      log a call against one, so their history lived in heads. Outreach to a
--      partner now goes in the same log as outreach to an agent.
--   2. `hiring_partners`: people inside organizations (workforce boards,
--      churches, veteran programs, staffing desks, schools) who know people who
--      need work. Two tracks — crew hiring and management hiring — worked the
--      same way, so `track` is a column and the app shows it as tabs, the same
--      reasoning as partners.type. Entered one at a time in the app; there is
--      no loader, so there is no natural key to match on.
--
-- One `touches` table rather than three. The contact scoreboard (0015) counts
-- touches by who logged them, and a call to a lender or a church is a call —
-- it belongs against the weekly target without a second view to union in.

-- ------------------------------------------------------------ hiring partners
create table if not exists public.hiring_partners (
  id                  uuid primary key default gen_random_uuid(),
  track               text not null check (track in ('crew', 'management')),
  person_name         text not null,
  title               text,
  organization        text,
  -- What kind of place it is: "Workforce board", "Church", "Veteran program"…
  -- Free text, suggested from what has been typed before, rather than a list
  -- someone has to edit a constraint to extend.
  org_type            text,
  phone               text,
  email               text,
  website             text,
  city                text,
  owner_name          text references public.people(name)
                      on update cascade on delete set null,
  owner_assigned_at   timestamptz,
  owner_assigned_by   text,
  relationship_status text not null default 'New — not contacted',
  do_not_contact      boolean not null default false,
  notes               text,
  last_touch          date,
  next_touch_due      date,
  created_by_email    text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.hiring_partners is
  'People inside organizations who can send us job candidates, split into crew
   and management hiring. Entered by hand in the app.';

create index if not exists hiring_partners_track_idx on public.hiring_partners (track, person_name);
create index if not exists hiring_partners_owner_idx on public.hiring_partners (owner_name);

create trigger hiring_partners_updated_at before update on public.hiring_partners
  for each row execute function public.touch_updated_at();

create trigger hiring_partners_stamp_owner before update on public.hiring_partners
  for each row execute function public.stamp_owner_change();

alter table public.hiring_partners enable row level security;

create policy hiring_partners_select on public.hiring_partners for select
  to authenticated using (public.is_goodguys());
create policy hiring_partners_insert on public.hiring_partners for insert
  to authenticated with check (public.is_goodguys());
create policy hiring_partners_update on public.hiring_partners for update
  to authenticated using (public.is_goodguys()) with check (public.is_goodguys());

grant select, insert, update on public.hiring_partners to authenticated;

-- ----------------------------------------------------------- partner schedule
-- The same two columns agents carry, maintained the same way: by the log.
alter table public.partners add column if not exists last_touch date;
alter table public.partners add column if not exists next_touch_due date;

-- ------------------------------------------------------------------- touches
-- A touch is against exactly one of an agent, a partner or a hiring partner.
alter table public.touches alter column agent_id drop not null;
alter table public.touches
  add column if not exists partner_id uuid references public.partners(id) on delete cascade;
alter table public.touches
  add column if not exists hiring_partner_id uuid references public.hiring_partners(id) on delete cascade;

alter table public.touches drop constraint if exists touches_one_subject;
alter table public.touches
  add constraint touches_one_subject
  check (num_nonnulls(agent_id, partner_id, hiring_partner_id) = 1);

create index if not exists touches_partner_idx on public.touches (partner_id, occurred_at desc)
  where partner_id is not null;
create index if not exists touches_hiring_partner_idx on public.touches (hiring_partner_id, occurred_at desc)
  where hiring_partner_id is not null;

-- The agent trigger is left alone. On a partner touch it is handed a null
-- agent_id, recompute_touch_schedule() finds no agent and returns.
--
-- Partners and hiring partners have no intro sequence — that is agent-shaped,
-- built around the moves we did on their sales. They get the plain rule the
-- agents had before 0011: last touch, plus settings.follow_up_days, and
-- "New — not contacted" becomes "Contacted" on the first one.
create or replace function public.sync_contact_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  gap integer;
  latest date;
begin
  select follow_up_days into gap from public.settings where id;
  gap := coalesce(gap, 30);

  -- Old and new both, so a touch moved from one partner to another (or
  -- deleted) recomputes the one it left.
  if tg_op <> 'INSERT' and old.partner_id is not null then
    select max(occurred_at)::date into latest from public.touches where partner_id = old.partner_id;
    update public.partners
       set last_touch = latest,
           next_touch_due = latest + gap,
           relationship_status = case
             when latest is null and relationship_status = 'Contacted' then 'New — not contacted'
             else relationship_status end
     where id = old.partner_id;
  end if;
  if tg_op <> 'DELETE' and new.partner_id is not null then
    select max(occurred_at)::date into latest from public.touches where partner_id = new.partner_id;
    update public.partners
       set last_touch = latest,
           next_touch_due = latest + gap,
           relationship_status = case
             when relationship_status = 'New — not contacted' then 'Contacted'
             else relationship_status end
     where id = new.partner_id;
  end if;

  if tg_op <> 'INSERT' and old.hiring_partner_id is not null then
    select max(occurred_at)::date into latest from public.touches where hiring_partner_id = old.hiring_partner_id;
    update public.hiring_partners
       set last_touch = latest,
           next_touch_due = latest + gap,
           relationship_status = case
             when latest is null and relationship_status = 'Contacted' then 'New — not contacted'
             else relationship_status end
     where id = old.hiring_partner_id;
  end if;
  if tg_op <> 'DELETE' and new.hiring_partner_id is not null then
    select max(occurred_at)::date into latest from public.touches where hiring_partner_id = new.hiring_partner_id;
    update public.hiring_partners
       set last_touch = latest,
           next_touch_due = latest + gap,
           relationship_status = case
             when relationship_status = 'New — not contacted' then 'Contacted'
             else relationship_status end
     where id = new.hiring_partner_id;
  end if;

  return null;
end;
$fn$;

-- 0016's rule: a new definer function gets its own REVOKE.
revoke all on function public.sync_contact_touch() from public, anon, authenticated;

drop trigger if exists touches_sync_contact on public.touches;
create trigger touches_sync_contact
  after insert or update or delete on public.touches
  for each row execute function public.sync_contact_touch();
