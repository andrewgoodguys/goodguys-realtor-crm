-- Which office an agent sits in, as its own column.
--
-- Brokerages run several offices - Ansley Real Estate has Alpharetta and
-- Buckhead - and until now the only place to record that was inside the
-- brokerage name itself. That is actively harmful: pipeline/owners.py derives
-- the Andrew/Avery split from md5(normalize_brokerage(brokerage)), and
-- normalize_brokerage strips 'atlanta' and 'georgia' but not 'alpharetta' or
-- 'buckhead'. So "Ansley Real Estate Buckhead" and "Ansley Real Estate
-- Alpharetta" hash to different buckets and one brokerage ends up split across
-- both owners. Keeping office separate leaves brokerage clean for the split.

alter table public.agents add column office text;

comment on column public.agents.office is
  'Branch within the brokerage, e.g. Alpharetta. Deliberately not part of
   brokerage: that field feeds the ownership hash in pipeline/owners.py.';

-- Filtering the agent list by office, and the per-brokerage suggestion list.
create index agents_office_idx on public.agents (office)
  where office is not null;
create index agents_brokerage_office_idx on public.agents (brokerage, office);

-- Distinct offices already recorded for a brokerage, for the picker to suggest.
-- Keeps spelling consistent without a lookup table to maintain.
create or replace function public.offices_for_brokerage(brokerage_name text)
returns table (office text)
language sql
stable
security invoker
set search_path = public
as $fn$
  select distinct a.office
    from public.agents a
   where a.brokerage is not distinct from brokerage_name
     and a.office is not null
     and a.office <> ''
   order by 1
$fn$;

grant execute on function public.offices_for_brokerage(text) to authenticated;
