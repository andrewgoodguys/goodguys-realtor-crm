-- GoodGuys Realtor CRM — initial schema
-- Replaces the "GoodGuys Realtor Referral Pipeline.xlsx" workbook.
--
-- Excel tab            -> table
--   Data               -> jobs
--   Agent Outreach     -> leads
--   Outreach Tracker   -> agents (+ touches for the human-owned columns)
--   Agent Summary      -> agent_summary (view)
--   Due This Week      -> due_this_week (view)
--   Run Log            -> runs

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- access
-- Anyone with a @goodguysserve.com email may use the app. Everything is
-- gated on this one function so the rule lives in exactly one place.
create or replace function public.is_goodguys()
returns boolean
language sql
stable
as $fn$
  select coalesce(auth.jwt() ->> 'email', '') ilike '%@goodguysserve.com'
$fn$;

comment on function public.is_goodguys is
  'True when the caller signed in with a goodguysserve.com address.';

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null unique,
  full_name   text,
  -- matches pipeline/config.py OWNERS; the md5-by-brokerage split assigns work
  owner_name  text check (owner_name in ('Andrew', 'Avery')),
  created_at  timestamptz not null default now()
);

-- Auto-create a profile on signup, and pre-map the two known owners.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  insert into public.profiles (id, email, full_name, owner_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)),
    case
      when new.email ilike 'andrew@%' then 'Andrew'
      when new.email ilike 'avery@%'  then 'Avery'
      else null
    end
  )
  on conflict (id) do nothing;
  return new;
end;
$fn$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------- jobs
-- Staged SmartMoving "All Jobs" export. One row per job.
create table public.jobs (
  id                  uuid primary key default gen_random_uuid(),
  sm_job_id           text unique,              -- SmartMoving "Job Id"
  job_number          text,                     -- e.g. "2055-2"
  opportunity_status  text,                     -- Booked / Lost / ...
  job_date            date,
  job_type            text,
  opportunity_type    text,
  customer_name       text,
  customer_phone      text,
  customer_email      text,
  branch_name         text,
  sales_person        text,
  referral_source     text,
  revenue             numeric(12,2),
  origin_address      text,
  destination_address text,
  raw                 jsonb not null default '{}'::jsonb,
  imported_at         timestamptz not null default now()
);

create index jobs_job_date_idx on public.jobs (job_date desc);
create index jobs_job_number_idx on public.jobs (job_number);

-- ---------------------------------------------------------------- agents
create table public.agents (
  id                  uuid primary key default gen_random_uuid(),
  name                text not null,
  name_key            text not null unique,     -- lower(trim(name)); one row per agent forever
  brokerage           text,
  phone               text,
  phone_type          text not null default 'unknown'
                        check (phone_type in ('direct', 'office', 'unknown')),
  email               text,

  -- Ownership: derived from md5(normalize_brokerage) in pipeline/owners.py so
  -- it stays stable across runs. Stored, not computed, so it can be overridden.
  owner_name          text check (owner_name in ('Andrew', 'Avery')),

  lifetime_jobs       integer not null default 0,
  lifetime_revenue    numeric(12,2) not null default 0,
  most_recent_job     date,

  relationship_status text not null default 'New — not contacted',
  priority            numeric(5,1) not null default 0,
  do_not_contact      boolean not null default false,

  last_touch          date,
  next_touch_due      date,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index agents_priority_idx on public.agents (priority desc);
create index agents_owner_idx on public.agents (owner_name);
create index agents_next_touch_idx on public.agents (next_touch_due);
create index agents_name_lower_idx on public.agents (lower(name));

-- ---------------------------------------------------------------- leads
-- One row per (job address x agent role). Mirrors the Agent Outreach tab.
create table public.leads (
  id             uuid primary key default gen_random_uuid(),
  week_added     text,
  job_id         uuid references public.jobs(id) on delete set null,
  job_number     text,
  job_date       date,
  customer_name  text,
  house_address  text,
  address_key    text,                          -- normalized, from pipeline/addresses.py
  agent_role     text check (agent_role in ('listing', 'buying')),
  agent_id       uuid references public.agents(id) on delete set null,
  sale_date      date,                          -- Redfin
  status         text not null default 'New',
  job_revenue    numeric(12,2),
  redfin_link    text,
  created_at     timestamptz not null default now()
);

create index leads_agent_idx on public.leads (agent_id);
create index leads_status_idx on public.leads (status);
create index leads_address_key_idx on public.leads (address_key);
create unique index leads_unique_addr_role on public.leads (address_key, agent_role)
  where address_key is not null and agent_role is not null;

-- ---------------------------------------------------------------- touches
-- Replaces the six human-owned Excel columns
-- (Email Sent / Text Sent / Call Made / Call Outcome / Response / Notes)
-- with an append-only activity log. Never written by the pipeline scripts.
create table public.touches (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references public.agents(id) on delete cascade,
  lead_id      uuid references public.leads(id) on delete set null,
  channel      text not null check (channel in ('call', 'text', 'email', 'note', 'meeting')),
  outcome      text,                            -- Connected / Voicemail / No answer / ...
  got_response boolean not null default false,
  notes        text,
  occurred_at  timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null,
  created_by_email text,
  created_at   timestamptz not null default now()
);

create index touches_agent_idx on public.touches (agent_id, occurred_at desc);
create index touches_occurred_idx on public.touches (occurred_at desc);

-- Keep agents.last_touch / next_touch_due in sync with the log.
-- REPEAT_TOUCH_COOLOFF_DAYS = 30 in pipeline/config.py.
create or replace function public.sync_agent_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid := coalesce(new.agent_id, old.agent_id);
  latest date;
begin
  select max(occurred_at)::date into latest
    from public.touches where agent_id = target;

  update public.agents
     set last_touch     = latest,
         next_touch_due = case when latest is null then null else latest + 30 end,
         relationship_status = case
           when latest is null then 'New — not contacted'
           when relationship_status = 'New — not contacted' then 'Contacted'
           else relationship_status
         end,
         updated_at = now()
   where id = target;

  return null;
end;
$fn$;

create trigger touches_sync_agent
  after insert or update or delete on public.touches
  for each row execute function public.sync_agent_touch();

-- ---------------------------------------------------------------- runs
create table public.runs (
  id                  uuid primary key default gen_random_uuid(),
  run_date            date not null,
  jobs_in_data        integer,
  addresses_processed integer,
  new_leads           integer,
  new_agents          integer,
  rechecks_resolved   integer,
  flagged_for_review  integer,
  notes               text,
  created_at          timestamptz not null default now()
);

create index runs_date_idx on public.runs (run_date desc);

-- ---------------------------------------------------------------- updated_at
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $fn$
begin
  new.updated_at = now();
  return new;
end;
$fn$;

create trigger agents_updated_at before update on public.agents
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- views
-- The "Due This Week" tab: uncontacted or cool-off-expired, highest priority
-- first. CONTACT_THIS_WEEK_N = 20 in config.py, applied in the UI not here.
create view public.due_this_week
with (security_invoker = true) as
select
  a.*,
  l.house_address as recent_address,
  l.customer_name as recent_customer,
  l.agent_role    as recent_role
from public.agents a
left join lateral (
  select house_address, customer_name, agent_role
    from public.leads
   where agent_id = a.id
   order by job_date desc nulls last
   limit 1
) l on true
where a.do_not_contact = false
  and (a.next_touch_due is null or a.next_touch_due <= current_date);

-- The "Agent Summary" tab.
create view public.agent_summary
with (security_invoker = true) as
select
  a.id,
  a.name,
  a.brokerage,
  a.owner_name,
  count(l.id)                              as lead_count,
  count(distinct l.address_key)            as address_count,
  coalesce(sum(l.job_revenue), 0)          as revenue,
  max(l.job_date)                          as most_recent_job,
  string_agg(distinct l.agent_role, ', ')  as roles
from public.agents a
left join public.leads l on l.agent_id = a.id
group by a.id;

-- ---------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.jobs     enable row level security;
alter table public.agents   enable row level security;
alter table public.leads    enable row level security;
alter table public.touches  enable row level security;
alter table public.runs     enable row level security;

-- Everyone on the goodguysserve.com domain gets full read/write. This is an
-- internal tool for a two-person sales desk; per-row ownership is a UI filter
-- (owner_name), deliberately not a security boundary.
do $do$
declare t text;
begin
  foreach t in array array['profiles','jobs','agents','leads','touches','runs'] loop
    execute format(
      'create policy %1$I_select on public.%1$I for select to authenticated using (public.is_goodguys());', t);
    execute format(
      'create policy %1$I_insert on public.%1$I for insert to authenticated with check (public.is_goodguys());', t);
    execute format(
      'create policy %1$I_update on public.%1$I for update to authenticated using (public.is_goodguys()) with check (public.is_goodguys());', t);
  end loop;
end
$do$;

-- Deleting is narrower: only touches and only your own, so outreach history
-- can be corrected but not quietly erased.
create policy touches_delete on public.touches for delete
  to authenticated using (public.is_goodguys() and created_by = auth.uid());

grant usage on schema public to authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant delete on public.touches to authenticated;
grant select on public.due_this_week, public.agent_summary to authenticated;
