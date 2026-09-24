-- Stop shipping the database's own functions to anyone holding the anon key.
--
-- `grant execute on function ... to authenticated` reads like a restriction and
-- is not one. Postgres grants EXECUTE on every new function to PUBLIC by
-- default, so each of those grants added a role that already had the right,
-- and nothing in 0001-0013 ever revoked the default. `anon` is a member of
-- PUBLIC, and the anon key is in the JS bundle by design — so every function
-- here has been callable by anybody who opened the site.
--
-- For a `security invoker` function that costs nothing: RLS still runs, and the
-- caller sees what they were always allowed to see. `security definer` is the
-- problem — it runs as the owner and RLS does not apply. Unauthenticated:
--
--   rebalance_plan()            186 rows of agent id + owner name
--   preview_rebalance()         the roster, and everyone's agent count
--   pick_owner_for()            a staff name
--   reschedule_follow_ups()     rewrote next_touch_due, relationship_status
--                               and next_step_number on EVERY agent
--   recompute_touch_schedule()  the same, for one agent id -- and the ids came
--                               from rebalance_plan() above
--
-- The write path is the one that matters, and it is older than the rebalance:
-- reschedule_follow_ups() has been unauthenticated since 0011. It recomputes
-- derived state from the touch log deterministically, so calling it does not
-- corrupt anything -- it lands on the values it would have landed on anyway.
-- That is luck about what the function happens to do, not a control.
--
-- Two changes, because either alone is thin:
--   1. REVOKE, which is the actual access control;
--   2. an is_goodguys() guard inside the definer functions the app calls, so a
--      future grant can't silently re-open them.
--
-- Left alone deliberately: is_goodguys(), is_goodguys_email() and
-- in_intro_sequence() are `security invoker` pure predicates that leak nothing
-- -- and is_goodguys() is called from every RLS policy, where `authenticated`
-- genuinely needs EXECUTE. offices_for_brokerage() is `security invoker`, so
-- RLS already answers for it.

-- --------------------------------------------------------------- the guards
-- rebalance_plan() becomes plpgsql only so it can refuse. The query below is
-- the one from 0013, unchanged.
create or replace function public.rebalance_plan()
returns table (agent_id uuid, from_owner text, to_owner text)
language plpgsql
stable
security definer
set search_path = public
as $fn$
#variable_conflict use_column
begin
  if not public.is_goodguys() then
    raise exception 'Not a GoodGuys account.';
  end if;

  return query
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
     where not a.do_not_contact
  )
  select r.id, r.owner_name, f.name
    from ranked r
    join folks f on f.idx = r.rn % f.n;
end;
$fn$;

-- preview_rebalance() stays SQL: it reads rebalance_plan(), so it inherits the
-- refusal above rather than repeating it.

-- The one that could be called by a stranger to write to every row.
create or replace function public.reschedule_follow_ups()
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  a uuid;
begin
  if not public.is_goodguys() then
    raise exception 'Not a GoodGuys account.';
  end if;

  for a in select id from public.agents loop
    perform public.recompute_touch_schedule(a);
  end loop;
end;
$fn$;

-- ------------------------------------------------------------- the revokes
-- Internal only. Both are reached from triggers and from other definer
-- functions, which call them as the owner -- EXECUTE is not rechecked there,
-- so taking it away from every caller does not break the cadence.
revoke all on function public.recompute_touch_schedule(uuid) from public, anon, authenticated;
revoke all on function public.pick_owner_for()               from public, anon, authenticated;

-- Called by the app, so `authenticated` keeps it -- and only `authenticated`.
-- Revoke first: the grants that follow are the whole permission, not a top-up.
revoke all on function public.ensure_my_person()          from public, anon, authenticated;
revoke all on function public.reschedule_follow_ups()     from public, anon, authenticated;
revoke all on function public.distribute_unassigned()     from public, anon, authenticated;
revoke all on function public.rebalance_plan()            from public, anon, authenticated;
revoke all on function public.preview_rebalance()         from public, anon, authenticated;
revoke all on function public.rebalance_all_agents()      from public, anon, authenticated;
revoke all on function public.undo_rebalance(uuid)        from public, anon, authenticated;

grant execute on function public.ensure_my_person()       to authenticated;
grant execute on function public.reschedule_follow_ups()  to authenticated;
grant execute on function public.distribute_unassigned()  to authenticated;
grant execute on function public.rebalance_plan()         to authenticated;
grant execute on function public.preview_rebalance()      to authenticated;
grant execute on function public.rebalance_all_agents()   to authenticated;
grant execute on function public.undo_rebalance(uuid)     to authenticated;

-- offices_for_brokerage() is security invoker, but there is no reason for a
-- signed-out visitor to enumerate offices either.
revoke all on function public.offices_for_brokerage(text) from public, anon;
grant execute on function public.offices_for_brokerage(text) to authenticated;

-- ------------------------------------------------------------ and next time
-- So the next migration doesn't reintroduce this by writing a function and a
-- grant that looks sufficient. This binds functions created by the role that
-- runs migrations, which is how every migration here is applied.
alter default privileges in schema public revoke execute on functions from public;
