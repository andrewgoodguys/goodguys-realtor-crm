-- The one id that can address a SmartMoving page.
--
-- A job in SmartMoving is reached at
--
--   https://app.smartmoving.com/opportunities/{opportunityId}/sales?jobId={jobId}
--
-- and the two ids are different things. jobs.sm_job_id already holds the
-- second: the All Jobs export's "Job Id" column is exactly the jobId query
-- parameter. The first is not in that export at all, and cannot be added to it
-- - the All Jobs report takes parameters (sales person, branches, date range,
-- email) but has no column picker.
--
-- Nor can the job id stand in for it. Verified against the live app:
--   /opportunities/{sm_job_id}/sales  -> "The specified opportunity was not found."
--   /jobs/{sm_job_id}                 -> redirects to /home
--
-- So it is fetched from the SmartMoving Open API instead, keyed on the quote
-- number, which *is* derivable from what we have: job_number is "{quote}-{seq}"
-- for all 877 rows, so "1981-1" is job 1 of quote 1981.
-- scripts/backfill_sm_opportunity_ids.py does the fetch.

alter table public.jobs add column sm_opportunity_id text;

comment on column public.jobs.sm_opportunity_id is
  'SmartMoving opportunity GUID, from GET /api/opportunities/quote/{n}. The
   path segment of an app.smartmoving.com deep link; sm_job_id is the jobId
   query parameter. Null until the backfill has seen this job''s quote.';

-- The backfill walks unresolved jobs in quote-number order; the app reads it
-- through leads.job_id, which is already indexed.
create index jobs_sm_opportunity_idx on public.jobs (sm_opportunity_id)
  where sm_opportunity_id is not null;
