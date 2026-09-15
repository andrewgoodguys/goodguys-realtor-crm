-- Any GoodGuys employee gets an identity, and can take agents for themselves.
--
-- Signing in was never the restriction: is_goodguys() has always let anyone on
-- goodguysserve.com read and write every table. What a new employee did not
-- get was a *name*. Two places decided that, and both knew exactly two people:
--
--   * handle_new_user() mapped andrew@ and avery@ to their owner and left
--     owner_name null for everybody else;
--   * ownerFromEmail() in src/hooks/useAuth.tsx matched the same two prefixes
--     client-side, so "Mine" on the call list was empty for anyone else.
--
-- A null owner means no call list of your own, and no row in public.people
-- means nobody can assign you an agent even by hand. So a third employee could
-- see everything and own nothing.
--
-- This links a person to a login by email, creates that link automatically for
-- new signups and for anyone already signed in, and records who took an agent.

-- ---------------------------------------------------------------- the domain
-- The rule was written inline in one function that read the JWT. It now takes
-- the address as an argument too, because the signup trigger fires on
-- auth.users, where there is no JWT to read.
create or replace function public.is_goodguys_email(addr text)
returns boolean
language sql
immutable
as $fn$
  select coalesce(addr, '') ilike '%@goodguysserve.com'
$fn$;

create or replace function public.is_goodguys()
returns boolean
language sql
stable
as $fn$
  select public.is_goodguys_email(auth.jwt() ->> 'email')
$fn$;

comment on function public.is_goodguys is
  'True when the caller signed in with a goodguysserve.com address.';

-- ------------------------------------------------------- people have logins
-- Nullable: a name can be typed into Settings before that person has ever
-- signed in, and stays assignable until they do. Lowercase is enforced rather
-- than assumed, because the link is looked up by equality.
alter table public.people add column if not exists email text;

alter table public.people drop constraint if exists people_email_lower;
alter table public.people add constraint people_email_lower
  check (email is null or email = lower(email));

create unique index if not exists people_email_key on public.people (email);

comment on column public.people.email is
  'The login this person signs in with. Null until they first sign in, or if
   they never do. Unique, so one address cannot own two names.';

comment on table public.people is
  'Who agents can be assigned to. Anyone who signs in on the GoodGuys domain is
   added here automatically; the seed mirrors OWNERS in pipeline/config.py.';

-- ----------------------------------------------------------- deriving a name
-- "sarah.miller@goodguysserve.com" -> "Sarah Miller". The display name from
-- the identity provider wins when there is one; the local part is the fallback
-- because it is what these addresses are built from.
create or replace function public.person_name_from(addr text, full_name text)
returns text
language sql
immutable
as $fn$
  select nullif(trim(coalesce(
    nullif(trim(full_name), ''),
    initcap(replace(replace(split_part(lower(coalesce(addr, '')), '@', 1),
                            '.', ' '), '_', ' '))
  )), '')
$fn$;

-- ----------------------------------------------------------- find or create
-- Returns the people.name this address owns, creating the row if needed.
--
-- The order matters. Claiming an existing unlinked row before inserting a new
-- one is what stops "Jack Sawyer" and "Jack" sitting side by side, one of them
-- owning every agent and the other owning the login. A name seeded here or
-- typed into Settings connects to the right person the first time they sign
-- in, however their address happens to be spelled.
--
-- security definer because the signup trigger runs before there is a session,
-- and deliberately not executable by clients: it would let any signed-in user
-- mint people rows for addresses that are not theirs. ensure_my_person() is
-- the door in, and it only ever acts on the caller.
create or replace function public.link_person(
  addr text, full_name text, preferred text default null
)
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  low       text := lower(trim(coalesce(addr, '')));
  base      text;
  candidate text;
  found     text;
  matches   integer;
  n         integer := 1;
begin
  if not public.is_goodguys_email(low) then
    return null;
  end if;

  -- 1. Already linked.
  select name into found from public.people where email = low;
  if found is not null then
    return found;
  end if;

  -- 2. The mapping this login already had, from before it had an email.
  if preferred is not null then
    update public.people set email = low
     where name = preferred and email is null
    returning name into found;
    if found is not null then
      return found;
    end if;
  end if;

  base := coalesce(public.person_name_from(low, full_name), low);

  -- 3. A name already waiting for its owner.
  update public.people set email = low
   where lower(name) = lower(base) and email is null
  returning name into found;
  if found is not null then
    return found;
  end if;

  -- 3b. Addresses here are first-name-only as often as not, so "jack@" should
  --     find the seeded "Jack Sawyer" rather than open a second account beside
  --     it. Only when the first name picks out exactly one unclaimed person:
  --     two Jacks is precisely the case where guessing is worst.
  if base not like '% %' then
    select count(*) into matches
      from public.people
     where email is null and lower(split_part(name, ' ', 1)) = lower(base);

    if matches = 1 then
      update public.people set email = low
       where email is null and lower(split_part(name, ' ', 1)) = lower(base)
      returning name into found;
      return found;
    end if;
  end if;

  -- 4. New. Suffix rather than fail if two employees share a display name;
  --    Settings can rename, and renaming carries their agents with them.
  candidate := base;
  while exists (select 1 from public.people where name = candidate) loop
    n := n + 1;
    candidate := base || ' ' || n;
  end loop;

  insert into public.people (name, email, sort_order)
  values (candidate, low,
          coalesce((select max(sort_order) from public.people), 0) + 1)
  returning name into found;

  return found;
end;
$fn$;

revoke all on function public.link_person(text, text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------- on first sign-in
-- The signup trigger only fires for accounts created after this migration.
-- Everyone already signed in — Andrew and Avery included — converges through
-- here instead; the app calls it once per session.
create or replace function public.ensure_my_person()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  addr   text := lower(auth.jwt() ->> 'email');
  me     uuid := auth.uid();
  fname  text;
  mapped text;
  person text;
begin
  if me is null or not public.is_goodguys_email(addr) then
    return null;
  end if;

  select full_name, owner_name into fname, mapped
    from public.profiles where id = me;

  person := public.link_person(addr, fname, mapped);
  if person is null then
    return null;
  end if;

  -- Usually an update of one row. The insert is for the case where the signup
  -- trigger never ran or its insert lost a race: without it that user would
  -- get a people row and still no profile to point at it, and would arrive
  -- here with a null mapping again on every single sign-in.
  insert into public.profiles (id, email, full_name, owner_name)
  values (me, addr, coalesce(fname, split_part(addr, '@', 1)), person)
  on conflict (id) do update
    set owner_name = excluded.owner_name
  where profiles.owner_name is distinct from excluded.owner_name;

  return person;
end;
$fn$;

comment on function public.ensure_my_person is
  'The caller''s row in public.people, created and linked on first call.
   Safe to call on every sign-in: a no-op once the link exists.';

grant execute on function public.ensure_my_person() to authenticated;

-- ------------------------------------------------------------ signup trigger
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  person text;
begin
  -- Bookkeeping must never block a signup, so a failure here costs the new
  -- user their auto-assigned name and nothing else; ensure_my_person() picks
  -- it up the moment they load the app.
  begin
    person := public.link_person(new.email, new.raw_user_meta_data ->> 'full_name');
  exception when others then
    person := null;
  end;

  insert into public.profiles (id, email, full_name, owner_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    person
  )
  on conflict (id) do nothing;

  return new;
end;
$fn$;

-- ---------------------------------------------------------------- the roster
-- Seeded by name, with no email. Each one is assignable from today, and claims
-- its own row the first time that person signs in — by exact name if their
-- address spells it out, by first name if it does not (3b above).
--
-- on conflict do nothing: this migration must be safe to run twice, and a name
-- that is already here has already been sorted out.
insert into public.people (name, sort_order)
values ('Jack Sawyer', 3), ('Trent Barron', 4), ('Sy Lovingood', 5)
on conflict (name) do nothing;

-- ------------------------------------------------------------------ backfill
-- Andrew and Avery first, by the mapping they already have, so they keep the
-- names their agents are assigned to rather than getting new rows.
-- distinct on: if two logins somehow claim one person the lower address wins,
-- and the other is picked up by the loop below.
update public.people p
   set email = pick.email
  from (
    select distinct on (owner_name) owner_name, lower(email) as email
      from public.profiles
     where owner_name is not null
       and public.is_goodguys_email(email)
     order by owner_name, lower(email)
  ) pick
 where p.name = pick.owner_name
   and p.email is null;

-- Then anyone who has signed in but was never mapped to anybody.
do $do$
declare
  r      record;
  person text;
  made   integer := 0;
begin
  for r in
    select id, email, full_name
      from public.profiles
     where owner_name is null
       and public.is_goodguys_email(email)
     order by created_at
  loop
    person := public.link_person(r.email, r.full_name);
    if person is not null then
      update public.profiles set owner_name = person where id = r.id;
      made := made + 1;
    end if;
  end loop;

  raise notice '% existing sign-in(s) given a name.', made;
end
$do$;

-- --------------------------------------------------- who took this, and when
-- "My agents" was a column you could overwrite with no trace. With five people
-- assigning instead of two, the useful question stops being who owns an agent
-- and becomes when they started to — an agent claimed this morning and one
-- carried since the first import are not the same thing, and neither is a
-- reassignment nobody remembers making.
alter table public.agents add column if not exists owner_assigned_at timestamptz;
alter table public.agents add column if not exists owner_assigned_by text;

comment on column public.agents.owner_assigned_at is
  'When owner_name last changed. Null for the original md5-by-brokerage split,
   which nobody chose and which predates this column.';
comment on column public.agents.owner_assigned_by is
  'Who made that change, as an email. Null when the pipeline or an import did.';

-- Stamped in a trigger rather than by the app, so a reassignment from the API,
-- a script or the SQL editor is recorded the same way as one made by clicking.
create or replace function public.stamp_owner_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.owner_name is distinct from old.owner_name then
    new.owner_assigned_at := now();
    new.owner_assigned_by := auth.jwt() ->> 'email';
  end if;
  return new;
end;
$fn$;

drop trigger if exists agents_stamp_owner on public.agents;
create trigger agents_stamp_owner before update on public.agents
  for each row execute function public.stamp_owner_change();

-- ---------------------------------------------------------------- unassigned
-- Nothing has ever pointed at agents with no owner, because until now the
-- split covered everybody by construction. It no longer does: an agent handed
-- back is an agent nobody is calling, and that has to be visible.
create index if not exists agents_unassigned_idx on public.agents (priority desc)
  where owner_name is null and do_not_contact = false;

-- --------------------------------------------------------------- the workload
-- The dashboard drew a two-segment bar from two hardcoded counts. One row per
-- person instead, so a new employee appears the day they sign in.
--
-- left join, so somebody who owns nothing yet still shows up at zero — which
-- is the state that makes "assign to me" worth reaching for.
create or replace view public.owner_workload
with (security_invoker = true) as
select
  p.name       as owner_name,
  p.email,
  p.active,
  p.sort_order,
  count(a.id) filter (where not a.do_not_contact) as agent_count,
  count(a.id) filter (
    where not a.do_not_contact
      and (a.next_touch_due is null or a.next_touch_due <= current_date)
  )            as due_count
from public.people p
left join public.agents a on a.owner_name = p.name
group by p.name, p.email, p.active, p.sort_order;

comment on view public.owner_workload is
  'One row per person, with the agents assigned to them. Counts exclude
   do-not-contact, matching the Active agents figure on the dashboard.';

grant select on public.owner_workload to authenticated;

-- Ownership stays a filter, not a boundary: every policy on agents is still
-- is_goodguys(), so taking an agent is an ordinary update and anyone can hand
-- one back. Nothing here narrows who can see what.
--
-- Note for the weekly run: pipeline/owners.py still splits new agents by
-- md5-of-brokerage across OWNERS in pipeline/config.py, which knows only the
-- names listed there. People added here are assignable in the app immediately;
-- they join the automatic split only when that list is updated too.
