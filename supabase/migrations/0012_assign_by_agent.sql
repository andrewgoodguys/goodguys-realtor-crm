-- Assign by the agent, not by the firm they happen to work at.
--
-- 0011 kept one idea from the old md5 split: a new agent went to whoever
-- already worked that brokerage, on the reasoning that one firm should mean one
-- relationship. Only after that did it fall back to whoever was carrying least.
--
-- That reasoning inherits the original problem in a quieter form. Brokerage is
-- free text scraped off Redfin, so "one firm" is whatever the string happens to
-- match — and the biggest firms are the biggest precisely because they have the
-- most agents, so the brokerage rule pulls the heaviest caseloads heavier. With
-- 49 firms and five people it does not converge on anything balanced: whoever
-- got the first Keller Williams agent gets all of them, forever.
--
-- So the brokerage step comes out. An explicit default still wins; otherwise
-- the agent goes to whoever is carrying the fewest. Nothing here reassigns an
-- agent that already has an owner — that was true in 0011 and stays true.

-- The signature changes, so replace will not do: brokerage is no longer an
-- input to the decision and leaving a vestigial argument would invite someone
-- to start passing it again. plpgsql bodies are not dependency-tracked, so the
-- callers below are rewritten in the same migration rather than broken by this.
drop function if exists public.pick_owner_for(text);

create or replace function public.pick_owner_for()
returns text
language plpgsql
security definer
set search_path = public
as $fn$
declare
  chosen text;
begin
  -- An explicit choice in Settings still beats any rule.
  select default_owner into chosen from public.settings where id;
  if chosen is not null then
    return chosen;
  end if;

  -- Whoever is carrying the fewest live agents. do_not_contact excluded: an
  -- agent nobody may call is not work, and counting them would quietly protect
  -- whoever happens to hold the most of them.
  --
  -- Ties break on sort_order so the result does not depend on row order, which
  -- also makes this round-robin rather than random while several people are
  -- level — the state Jack, Trent and Sy are in now.
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
  'Owner for a NEW agent: the Settings default, else whoever is carrying the
   fewest. Assignment is per agent — the brokerage is not consulted. Never
   reassigns an agent that already has an owner.';

create or replace function public.assign_new_agent()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.owner_name is null then
    new.owner_name := public.pick_owner_for();
  end if;
  return new;
end;
$fn$;

-- Still row by row: least-loaded has to see the effect of the assignment
-- before it, or every agent in the pile goes to the same person. That was true
-- when the brokerage rule was there and is more true now that it is gone.
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
    select id from public.agents
     where owner_name is null and not do_not_contact
     order by priority desc, name
  loop
    who := public.pick_owner_for();
    exit when who is null;           -- nobody active to receive them
    update public.agents set owner_name = who where id = r.id;
    moved := moved + 1;
  end loop;

  return moved;
end;
$fn$;

comment on function public.distribute_unassigned is
  'Hand every ownerless active agent to somebody, evenly. Returns how many
   moved. Safe to run twice — the second run finds nothing.';

-- Highest priority first, so the top of the pile is dealt before the tail —
-- distribute_unassigned() orders by it and the planner should not have to sort
-- the whole table to find out who is unassigned.
create index if not exists agents_unassigned_priority_idx
  on public.agents (priority desc, name)
  where owner_name is null and do_not_contact = false;
