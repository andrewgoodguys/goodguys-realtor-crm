-- Referral partners who are not realtors: mortgage lenders, home organizers,
-- insurance agents, and everyone else (estate sale companies, property
-- managers).
--
-- One table, not four. The four kinds are worked the same way — find them,
-- claim them, call them — and differ only in which list they sit on, so `type`
-- is a column and the app shows it as tabs. A fifth kind is a check-constraint
-- edit, not a new table, page and set of policies.
--
-- Deliberately separate from `agents`. Agents arrive from closed moves and are
-- scored by the pipeline; partners arrive from desk research and are ranked by
-- what was published about them (volume, reviews). Mixing them would put a
-- researched lender on the call list next to a realtor who sent us a job.
--
-- Ownership works exactly as it does for agents: blank on arrival, claimed in
-- the app, stamped by stamp_owner_change() (0010). The loader never sends
-- owner_name, relationship_status, notes or do_not_contact.

create table if not exists public.partners (
  id                  uuid primary key default gen_random_uuid(),
  type                text not null
                      check (type in ('mortgage_lender', 'home_organizer',
                                      'insurance_agent', 'other_partner')),
  subtype             text,
  -- Position on its own list when researched (1 = top). Rank restarts per
  -- subtype on the "other" list, so sort by (subtype, rank) there.
  rank                integer,
  person_name         text,
  title               text,
  company             text,
  -- NMLS id for lenders, license number for insurance; null elsewhere.
  license             text,
  phone               text,
  email               text,
  website             text,
  city                text,
  volume              text,
  review_count        integer,
  rating              numeric(3, 2),
  rank_basis          text,
  source_urls         text[] not null default '{}',
  -- Same identity rule as agents.name_key: what the loader matches on, so a
  -- re-run updates a row instead of duplicating it.
  partner_key         text not null unique,
  owner_name          text references public.people(name)
                      on update cascade on delete set null,
  owner_assigned_at   timestamptz,
  owner_assigned_by   text,
  relationship_status text not null default 'New — not contacted',
  do_not_contact      boolean not null default false,
  notes               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint partners_has_a_name check (coalesce(person_name, company) is not null)
);

comment on table public.partners is
  'Non-realtor referral partners, from desk research. One row per person (lenders,
   insurance) or business (organizers, estate sales, property managers).';

create index if not exists partners_type_rank_idx on public.partners (type, subtype, rank);
create index if not exists partners_owner_idx on public.partners (owner_name);

create trigger partners_updated_at before update on public.partners
  for each row execute function public.touch_updated_at();

create trigger partners_stamp_owner before update on public.partners
  for each row execute function public.stamp_owner_change();

alter table public.partners enable row level security;

create policy partners_select on public.partners for select
  to authenticated using (public.is_goodguys());
create policy partners_insert on public.partners for insert
  to authenticated with check (public.is_goodguys());
create policy partners_update on public.partners for update
  to authenticated using (public.is_goodguys()) with check (public.is_goodguys());

grant select, insert, update on public.partners to authenticated;
