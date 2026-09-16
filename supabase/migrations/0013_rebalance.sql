-- Deal the whole book out again, evenly, and be able to take it back.
--
-- 0012 changed how a *new* agent is assigned. It deliberately did not touch the
-- ones already here, so the book still sits the way the md5-by-brokerage split
-- left it: two people holding everything and three holding nothing. Onboarding
-- three people is exactly the moment that needs fixing, and it is not something
-- pick_owner_for() will ever do on its own — it only ever fires on insert.
--
-- This rewrites owner_name on every active agent at once, which is the largest
-- single change anyone can make to who does what. So it is built in three
-- pieces rather than one: see what it would do, do it, and undo it.
--
-- Dealt high-priority-first, round-robin. Not "give everything to whoever has
-- least until they catch up" — that balances the count and nothing else, and
-- would hand all twenty of this week's best agents to one person. Round-robin
-- down the priority order gives everybody a comparable share of the top of the
-- list, which is the part that actually matters.

-- ------------------------------------------------------------- the deal
-- One definition, used by the preview and by the real thing, so what you are
-- shown cannot differ from what you get.
create or replace function public.rebalance_plan()
returns table (agent_id uuid, from_owner text, to_owner text)
language sql
stable
security definer
set search_path = public
as $fn$
  with folks as (
    select p.name,
           row_number() over (order by p.sort_order, p.name) - 1 as idx,
           count(*) over ()                                      as n
      from public.people p
     where p.active
  ),
  ranked as (
    select a.id,
           a.owner_name,
           row_number() over (order by a.priority desc, a.name) - 1 as rn
      from public.agents a
     -- Do-not-contact agents are not work and are left exactly as they are.
     where not a.do_not_contact
  )
  select r.id, r.owner_name, f.name
    from ranked r
    join folks f on f.idx = r.rn % f.n
$fn$;

comment on function public.rebalance_plan is
  'Who every active agent would belong to after an even redeal: highest
   priority first, round-robin across active people in roster order.';

grant execute on function public.rebalance_plan() to authenticated;

-- What the split would look like, without changing anything. `moving` is the
-- number that matters — a redeal that moves 150 agents is a different decision
-- from one that moves 4.
create or replace function public.preview_rebalance()
returns table (owner_name text, agent_count bigint, moving bigint)
language sql
stable
security definer
set search_path = public
as $fn$
  select p.to_owner,
         count(*),
         count(*) filter (where p.from_owner is distinct from p.to_owner)
    from public.rebalance_plan() p
   group by p.to_owner
   order by p.to_owner
$fn$;

grant execute on function public.preview_rebalance() to authenticated;

-- ---------------------------------------------------------------- the record
-- Every redeal is written down before it happens. Without this, a rebalance is
-- the one action in the app that cannot be taken back: owner_assigned_at says
-- when an agent moved and owner_assigned_by says who moved them, but neither
-- says where they came from.
create table if not exists public.owner_rebalances (
  id         uuid primary key default gen_random_uuid(),
  run_id     uuid not null,
  agent_id   uuid not null references public.agents(id) on delete cascade,
  from_owner text,
  to_owner   text,
  run_at     timestamptz not null default now(),
  run_by     text
);

create index if not exists owner_rebalances_run_idx
  on public.owner_rebalances (run_id, run_at desc);

comment on table public.owner_rebalances is
  'One row per agent per redeal, holding the owner it had before. This is what
   makes undo_rebalance() possible.';

alter table public.owner_rebalances enable row level security;

create policy owner_rebalances_select on public.owner_rebalances for select
  to authenticated using (public.is_goodguys());

grant select on public.owner_rebalances to authenticated;

-- ------------------------------------------------------------------- do it
create or replace function public.rebalance_all_agents()
returns uuid
language plpgsql
security definer
set search_path = public
as $fn$
declare
  run uuid := gen_random_uuid();
  who text := auth.jwt() ->> 'email';
  n   integer;
begin
  if not public.is_goodguys() then
    raise exception 'Not a GoodGuys account.';
  end if;

  if not exists (select 1 from public.people where active) then
    raise exception 'Nobody active to deal to.';
  end if;

  -- Recorded first, and only where something actually changes: a redeal that
  -- leaves an agent where they were is not a move to undo.
  insert into public.owner_rebalances (run_id, agent_id, from_owner, to_owner, run_by)
  select run, p.agent_id, p.from_owner, p.to_owner, who
    from public.rebalance_plan() p
   where p.from_owner is distinct from p.to_owner;

  get diagnostics n = row_count;
  if n = 0 then
    return null;                       -- already even; nothing written, nothing to undo
  end if;

  update public.agents a
     set owner_name = r.to_owner
    from public.owner_rebalances r
   where r.run_id = run and r.agent_id = a.id;

  raise notice 'Redeal %: % agent(s) moved.', run, n;
  return run;
end;
$fn$;

comment on function public.rebalance_all_agents is
  'Deal every active agent out evenly. Returns the run id, or null if nothing
   moved. Pass that id to undo_rebalance() to put it all back.';

grant execute on function public.rebalance_all_agents() to authenticated;

-- ----------------------------------------------------------------- undo it
create or replace function public.undo_rebalance(run uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $fn$
declare
  n integer;
begin
  if not public.is_goodguys() then
    raise exception 'Not a GoodGuys account.';
  end if;

  -- Only puts back agents that still sit where the redeal put them. Anything
  -- claimed by hand since then stays claimed: an undo should reverse its own
  -- change, not overwrite somebody's later decision.
  update public.agents a
     set owner_name = r.from_owner
    from public.owner_rebalances r
   where r.run_id = run
     and r.agent_id = a.id
     and a.owner_name is not distinct from r.to_owner;

  get diagnostics n = row_count;

  delete from public.owner_rebalances where run_id = run;
  return n;
end;
$fn$;

comment on function public.undo_rebalance is
  'Put a redeal back. Skips any agent reassigned by hand since — an undo
   reverses its own change, not a later one. Returns how many were restored.';

grant execute on function public.undo_rebalance(uuid) to authenticated;

-- The most recent redeal, so the app can offer to undo it without being told
-- which one. Null when there is nothing to undo.
create or replace view public.last_rebalance
with (security_invoker = true) as
select run_id, min(run_at) as run_at, max(run_by) as run_by, count(*) as moved
  from public.owner_rebalances
 group by run_id
 order by min(run_at) desc
 limit 1;

grant select on public.last_rebalance to authenticated;
