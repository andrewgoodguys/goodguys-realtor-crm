-- Make the leads dedupe index usable by ON CONFLICT.
--
-- 0001 created this index with a WHERE predicate. Postgres will only infer a
-- partial index for ON CONFLICT if the statement repeats the same predicate,
-- and PostgREST has no way to send one — so every upsert failed with 42P10.
--
-- The predicate was redundant regardless: NULLs compare as distinct in a
-- unique index, so rows missing address_key or agent_role never conflicted
-- with each other under the partial index either. Dropping it changes no
-- behaviour and makes the index inferable.

drop index if exists public.leads_unique_addr_role;

create unique index leads_unique_addr_role
  on public.leads (address_key, agent_role);
