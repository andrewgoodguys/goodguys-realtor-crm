-- Who actually sends us work.
--
-- Everything so far measures agents by the moves we did on their *sales* —
-- lifetime_jobs, lifetime_revenue, priority. None of it says whether an agent
-- has ever picked up the phone and sent a customer to us, which is the whole
-- point of the relationship. SmartMoving records that on the job, in "Affiliate
-- Name": the referrer as somebody typed them in.
--
-- So: jobs keep the affiliate; `referrers` says which agent or partner each
-- affiliate name is; two views add it up. Nothing is stored on agents or
-- partners, so a relinked referrer or a reloaded job changes the figures with
-- no backfill.
--
-- A referral counts once the move happened — opportunity_status Closed or
-- Completed. Booked jobs are shown as upcoming; lost and cancelled are not
-- counted at all.

-- ---------------------------------------------------------------------- jobs
-- affiliate_key is the name as the pipeline normalizes it (pipeline/referrals.py:
-- lowercased, punctuation and the leading "*" dropped). It is computed in one
-- place, Python, rather than a second time here, so the join cannot drift.
alter table public.jobs add column if not exists affiliate_name text;
alter table public.jobs add column if not exists affiliate_key text;

create index if not exists jobs_affiliate_key_idx on public.jobs (affiliate_key)
  where affiliate_key is not null;

-- ----------------------------------------------------------------- referrers
create table if not exists public.referrers (
  id             uuid primary key default gen_random_uuid(),
  affiliate_key  text not null unique,
  affiliate_name text not null,          -- as last seen in SmartMoving
  -- SmartMoving's "*" prefix: GoodGuys owes this referrer a fee.
  pays_fee       boolean not null default false,
  agent_id       uuid references public.agents(id) on delete set null,
  partner_id     uuid references public.partners(id) on delete set null,
  -- Seen, and deliberately not anyone we track (a past customer, staff).
  ignored        boolean not null default false,
  link_note      text,                   -- how the link was decided
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint referrers_one_link check (num_nonnulls(agent_id, partner_id) <= 1)
);

comment on table public.referrers is
  'Each SmartMoving "Affiliate Name", and the agent or partner it is. Unlinked
   and not ignored = waiting for someone to say who it is.';

create trigger referrers_updated_at before update on public.referrers
  for each row execute function public.touch_updated_at();

alter table public.referrers enable row level security;

create policy referrers_select on public.referrers for select
  to authenticated using (public.is_goodguys());
create policy referrers_insert on public.referrers for insert
  to authenticated with check (public.is_goodguys());
create policy referrers_update on public.referrers for update
  to authenticated using (public.is_goodguys()) with check (public.is_goodguys());

grant select, insert, update on public.referrers to authenticated;

-- --------------------------------------------------------------------- views
-- security_invoker: the caller's RLS applies, exactly as if they had queried
-- jobs and referrers themselves.
create or replace view public.referred_jobs
with (security_invoker = true) as
select r.agent_id,
       r.partner_id,
       r.id                 as referrer_id,
       r.affiliate_name,
       r.pays_fee,
       j.id                 as job_id,
       j.job_number,
       j.job_date,
       j.customer_name,
       j.opportunity_status,
       j.revenue,
       j.opportunity_status in ('Closed', 'Completed') as counts
  from public.jobs j
  join public.referrers r on r.affiliate_key = j.affiliate_key;

create or replace view public.referral_totals
with (security_invoker = true) as
select agent_id,
       partner_id,
       count(*) filter (where counts)                          as referred_jobs,
       coalesce(sum(revenue) filter (where counts), 0)         as referred_revenue,
       count(*) filter (where opportunity_status = 'Booked')   as upcoming_jobs,
       max(job_date) filter (where counts)                     as last_referral,
       bool_or(pays_fee)                                       as pays_fee
  from public.referred_jobs
 where agent_id is not null or partner_id is not null
 group by agent_id, partner_id;

comment on view public.referral_totals is
  'One row per agent or partner who has referred a job: moves that happened
   (Closed/Completed), their revenue, booked-but-not-done, and the latest.';

grant select on public.referred_jobs, public.referral_totals to authenticated;
