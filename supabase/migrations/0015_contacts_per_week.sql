-- A weekly contact target per person, and a letter to put against it.
--
-- Three things, which belong together because the target is meaningless
-- without agreeing what counts toward it:
--
--   1. `letter` becomes a channel. Post is outreach; it just had nowhere to go.
--   2. `settings.weekly_contact_target` is the team default, and
--      `people.weekly_contact_target` overrides it for one person. Null means
--      "whatever the team default is" — so a new hire inherits a real number
--      rather than silently sitting at a target of zero, which would report
--      them as perfectly on track for doing nothing.
--   3. `contact_scoreboard` is the rollup: per person, what they owe this week,
--      what they have logged, and how far behind their agents have slipped.

-- ------------------------------------------------------------------ letters
-- Dropped by lookup rather than by name. The constraint was written inline in
-- 0001, so its name is whatever Postgres chose; asserting a guess here would
-- fail open — the drop would no-op and the old constraint would still reject
-- 'letter'.
do $$
declare
  c text;
begin
  for c in
    select con.conname
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace ns on ns.oid = rel.relnamespace
     where ns.nspname = 'public'
       and rel.relname = 'touches'
       and con.contype = 'c'
       and pg_get_constraintdef(con.oid) ilike '%channel%'
  loop
    execute format('alter table public.touches drop constraint %I', c);
  end loop;
end
$$;

alter table public.touches
  add constraint touches_channel_allowed
  check (channel in ('call', 'text', 'email', 'letter', 'note', 'meeting'));

-- What counts as having contacted somebody. Everything except `note`, which is
-- a record of something rather than an attempt to reach anyone — logging that
-- an agent changed brokerage is not outreach and should not fill a quota.
--
-- Deliberately NOT wired into recompute_touch_schedule(): that still counts
-- every touch row when advancing the intro sequence, so a note currently moves
-- an agent along. That is arguably wrong, but changing it would re-derive the
-- schedule for every agent already in the book, which is a bigger decision than
-- this migration should make on its own. One definition here, the older one
-- there, and this comment so the next person finds the seam.
create or replace function public.is_contact_channel(channel text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(channel, '') in ('call', 'text', 'email', 'letter', 'meeting')
$fn$;

comment on function public.is_contact_channel is
  'True for a channel that counts toward a weekly contact target — everything
   but `note`.';

-- 0014 revoked the PUBLIC default, so a new function gets nothing unless it is
-- said here. contact_scoreboard is security_invoker and calls this, which means
-- the *caller* needs EXECUTE, not the view's owner.
grant execute on function public.is_contact_channel(text) to authenticated;

-- ------------------------------------------------------------------ targets
alter table public.settings
  add column if not exists weekly_contact_target integer not null default 20
    check (weekly_contact_target between 0 and 500);

comment on column public.settings.weekly_contact_target is
  'Contacts per person per week, for anyone without their own number.';

alter table public.people
  add column if not exists weekly_contact_target integer
    check (weekly_contact_target between 0 and 500);

comment on column public.people.weekly_contact_target is
  'This person''s own weekly target. Null inherits settings.weekly_contact_target
   — an absent override, not a target of zero.';

-- --------------------------------------------------------------- the rollup
-- Weeks are Monday-to-Sunday in America/New_York, not UTC. On UTC a touch
-- logged at 8pm on a Sunday falls into the following week, which would move
-- work across the boundary it was meant to land inside. This is the only place
-- the zone is named; change it here if the company ever stops being in Georgia.
--
-- The two aggregates are built in separate CTEs and joined in, rather than
-- joined to `people` and counted together: touches-per-person and
-- agents-per-owner have no relationship to each other, and joining both at once
-- multiplies one by the other.
create or replace view public.contact_scoreboard
with (security_invoker = true) as
with bounds as (
  select date_trunc('week',  (now() at time zone 'America/New_York'))::date as week_start,
         date_trunc('month', (now() at time zone 'America/New_York'))::date as month_start
),
logged as (
  select lower(t.created_by_email) as email,
         count(*) filter (
           where (t.occurred_at at time zone 'America/New_York')::date >= b.week_start
         ) as done_this_week,
         count(*) filter (
           where (t.occurred_at at time zone 'America/New_York')::date >= b.month_start
         ) as done_this_month
    from public.touches t
    cross join bounds b
   where t.created_by_email is not null
     and public.is_contact_channel(t.channel)
   group by lower(t.created_by_email)
),
backlog as (
  select a.owner_name,
         count(*) filter (where a.next_touch_due < current_date) as overdue_agents,
         count(*) filter (
           where a.next_touch_due is null or a.next_touch_due <= current_date
         ) as due_agents
    from public.agents a
   where not a.do_not_contact
   group by a.owner_name
)
select
  p.name        as owner_name,
  p.email,
  p.active,
  p.sort_order,
  coalesce(p.weekly_contact_target, s.weekly_contact_target) as target,
  -- So Settings can show an inherited number differently from a typed one.
  (p.weekly_contact_target is not null)                      as has_own_target,
  coalesce(l.done_this_week, 0)                              as done_this_week,
  coalesce(l.done_this_month, 0)                             as done_this_month,
  -- Never negative: "8 to go" is the useful number, and a surplus reads off
  -- done vs target anyway.
  greatest(
    coalesce(p.weekly_contact_target, s.weekly_contact_target) - coalesce(l.done_this_week, 0),
    0
  )                                                          as remaining_this_week,
  coalesce(bk.overdue_agents, 0)                             as overdue_agents,
  coalesce(bk.due_agents, 0)                                 as due_agents
from public.people p
cross join public.settings s
left join logged  l  on l.email = p.email
left join backlog bk on bk.owner_name = p.name;

comment on view public.contact_scoreboard is
  'One row per person: the weekly contact target they are held to, what they
   have logged this week and this month, and how many of their agents are due
   or overdue. Touches are counted by who logged them, not by who owns the
   agent — the target measures a person''s own week.';

grant select on public.contact_scoreboard to authenticated;
