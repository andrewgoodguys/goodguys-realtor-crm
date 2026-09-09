-- Brokerages as a place you can stand, not just a column you can filter on.
--
-- 0004 gave agents an office. This is the roll-up the brokerage pages read:
-- one row per firm, with the counts that decide whether it is worth a visit.
-- A view rather than a table because brokerage is free text on agents, and a
-- second copy of the list would drift the first time someone fixes a spelling.
--
-- security_invoker, like the other views here, so RLS on agents still applies
-- and this cannot become a way around is_goodguys().

create view public.brokerage_summary
with (security_invoker = true) as
select
  a.brokerage,
  count(*)                                                  as agent_count,
  count(distinct a.office)                                  as office_count,
  count(*) filter (where a.office is null)                  as unplaced_count,
  count(*) filter (where a.do_not_contact)                  as dnc_count,
  count(*) filter (
    where not a.do_not_contact
      and (a.next_touch_due is null or a.next_touch_due <= current_date)
  )                                                         as due_count,
  coalesce(sum(a.lifetime_jobs), 0)                         as lifetime_jobs,
  coalesce(sum(a.lifetime_revenue), 0)                      as lifetime_revenue,
  max(a.most_recent_job)                                    as most_recent_job,
  max(a.priority)                                           as top_priority,
  string_agg(distinct a.owner_name, ', ')                   as owners
from public.agents a
where a.brokerage is not null and a.brokerage <> ''
group by a.brokerage;

comment on view public.brokerage_summary is
  'One row per brokerage, for /brokerages. office_count counts distinct
   non-null offices, so a firm with one unnamed location reads as 0 offices
   and unplaced_count tells you how many agents have no branch recorded.';

grant select on public.brokerage_summary to authenticated;
