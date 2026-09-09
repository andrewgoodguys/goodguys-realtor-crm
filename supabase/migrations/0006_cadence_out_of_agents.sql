-- Move the outreach cadence out of public.agents.
--
-- 0005 created public.outreach_steps and deliberately left the data alone:
-- "moving the existing rows is a separate migration ... written against what
-- those seven rows actually contain, not against a guess." This is that
-- migration, and the first thing reading the rows turned up is that there are
-- eight of them, not seven.
--
-- They come from the workbook scripts/import_workbook.py actually reads,
--   OneDrive\Documents\Sales\Realtor Outreach\
--     GoodGuys Realtor Referral Pipeline.xlsx
-- sheet "Outreach Tracker", rows 189-196, where the cadence was typed as a
-- footnote block into column A (Agent Name) with every other column blank:
--
--   OUTREACH CADENCE RULES (anti-pestering)
--   1. Intro sequence per agent, ONCE ever: Text (day 1) -> Call (day 4) ->
--      Email (day 7). Log each touch date in the columns above - Last Touch,
--      Next Touch Due and Next Action calculate themselves.
--   2. No response after the full sequence -> status "Attempted - no
--      response." Wait 90 days before any new touch.
--   3. Agent appears on a NEW closed job -> one congratulatory touch only, and
--      only if last touch was 30+ days ago.
--   4. One channel per touch. Never call, text, AND email on the same day.
--   5. "DO NOT CONTACT" status is permanent - weekly runs skip these agents
--      automatically.
--   6. In conversation / partner agents: relationship-driven contact only, no
--      templates.
--   7. Priority Score and "Contact This Week" are set by the weekly run - top
--      20 uncontacted agents. Work the Due This Week tab.
--
-- build_agents() skipped a tracker row only when Agent Name was empty, so all
-- eight became agents. They have no Office, and owner_for_brokerage("")
-- returns OWNERS[0], so all eight landed in Andrew's call list rather than
-- being split.
--
-- Only rule 1 is a cadence in the sense outreach_steps models. Rules 2-7 are
-- policy with no day_offset and no channel, and each is already enforced
-- somewhere else in the system:
--
--   2 -> the 90-day wait after "Attempted - no response" is a human decision;
--        settings.follow_up_days sets the ordinary gap.
--   3 -> sync_agent_touch() schedules next_touch_due settings.follow_up_days
--        out (default 30), which is the "30+ days ago" test.
--   4 -> one touches row per contact, one channel each.
--   5 -> agents.do_not_contact, honoured by the call list and by the pipeline.
--   6 -> relationship_status "In conversation" / "Partner"; the templates are
--        a suggestion, never sent automatically.
--   7 -> agents.priority, written by the weekly run; the call list is the Due
--        This Week tab.
--
-- They are recorded verbatim above and in README.md so deleting the rows does
-- not delete the rule.
--
-- A ninth row may also be present, depending on which workbook was imported.
-- An older copy of the file (Documents\Sales\, no "Realtor Outreach" folder)
-- carries "- not reported to MLS", a footnote to the jobs count that also
-- picked up "TBD - lookup" in Phone and Email and 4 lifetime jobs, so unlike
-- the cadence rows it scores a priority and reads as a live agent. It never
-- dials - dialable() rejects the placeholder - but it is not a person either.
-- The current workbook has no such row; this deletes it if an earlier import
-- put it there and is a no-op otherwise. Leads pointing at it are leads whose
-- agent the MLS did not report, and leads_agent_id_fkey is ON DELETE SET NULL,
-- so they come out of this correctly agent-less.

-- --------------------------------------------------------- the cadence
-- Rule 1, as steps. day_offset is days *after* the first touch (0005), while
-- the workbook numbers days from 1, so "day 1 / day 4 / day 7" re-indexes to
-- 0 / 3 / 6. The gaps are unchanged; only the origin moves.
--
-- Note the order: text, then call, then email. The workbook was revised on
-- 2026-08-14 and an earlier copy had it as email -> text -> call. This is the
-- live one.
--
-- body stays null on purpose: the wording lives in public.settings
-- (text_template, email_subject/email_body, call_script) and must not be
-- duplicated here.
insert into public.outreach_steps (step_number, day_offset, channel, label)
values
  (1, 0, 'text',  'Intro text — day 1'),
  (2, 3, 'call',  'Intro call — day 4'),
  (3, 6, 'email', 'Intro email — day 7')
on conflict (step_number) do nothing;

-- ------------------------------------------------------- the fake agents
-- Not ON COMMIT DROP: the SQL editor runs each statement in its own
-- transaction, which would drop the table before the DO block below sees it.
drop table if exists pg_temp._not_people;
create temporary table _not_people as
select id, name
  from public.agents
 where name_key = 'outreach cadence rules (anti-pestering)'
    or name_key like '%not reported to mls'
    or (name_key ~ '^[0-9]+\. '
        and brokerage is null and phone is null and email is null);

do $$
declare
  n_rows    integer;
  n_touches integer;
  n_leads   integer;
begin
  select count(*) into n_rows from _not_people;

  -- Eight from the current workbook, plus at most the one stray from the old
  -- copy. More than that means the predicate is catching something it was not
  -- written for; stop rather than delete a real agent.
  if n_rows > 9 then
    raise exception
      'Aborting: predicate matched % rows, expected at most 9. Inspect _not_people before rerunning.', n_rows;
  end if;

  -- touches cascade on delete. Anything logged against one of these rows is a
  -- touch against a real person recorded in the wrong place, and moving it is
  -- a judgement call, not a migration.
  select count(*) into n_touches
    from public.touches t join _not_people p on p.id = t.agent_id;
  if n_touches > 0 then
    raise exception
      'Aborting: % touch row(s) are logged against rows this migration deletes. Reassign them, then rerun.', n_touches;
  end if;

  select count(*) into n_leads
    from public.leads l join _not_people p on p.id = l.agent_id;

  delete from public.agents a using _not_people p where a.id = p.id;

  raise notice 'Removed % non-person agent row(s); % lead(s) unlinked.', n_rows, n_leads;
end $$;

drop table pg_temp._not_people;
