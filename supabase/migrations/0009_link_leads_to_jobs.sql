-- Connect leads to the jobs they came from.
--
-- leads.job_id has existed since 0001 and has been null on every row: 552 of
-- 552. build_leads() in scripts/import_workbook.py wrote job_number, the human
-- label, and never the foreign key beside it. Nothing depended on the link, so
-- nothing noticed.
--
-- 0007 gave it a job. A SmartMoving deep link is built from jobs.sm_job_id and
-- jobs.sm_opportunity_id, and the only route from a lead to those columns is
-- leads.job_id -> jobs.id. With the key null the embed resolves to nothing and
-- the link never appears, however well the backfill worked.
--
-- job_number is unique across all 877 job rows - checked, zero duplicates - so
-- this is a 1:1 match, not a best guess. The importer now sets job_id too, so
-- rows arriving after this already carry it.

update public.leads l
   set job_id = j.id
  from public.jobs j
 where l.job_id is null
   and l.job_number is not null
   and j.job_number = l.job_number;

do $$
declare
  linked   integer;
  orphaned integer;
begin
  select count(*) filter (where job_id is not null),
         count(*) filter (where job_id is null and job_number is not null)
    into linked, orphaned
    from public.leads;

  raise notice '% lead(s) linked to a job; % still unmatched.', linked, orphaned;

  -- Unmatched means the lead names a job number that is not in public.jobs -
  -- an older move that fell outside the trailing-12-month All Jobs export.
  -- Worth seeing, not worth failing over.
end $$;

-- Finding every lead of a job is now a lookup rather than a string comparison.
create index if not exists leads_job_idx on public.leads (job_id)
  where job_id is not null;
