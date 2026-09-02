-- A home for the outreach cadence.
--
-- The steps of the sequence are currently sitting in public.agents as if they
-- were realtors. That is wrong in every direction: they inflate the agent
-- count, they surface in the call list and search, priority scoring runs over
-- them, and public.people ownership gets assigned to things that are not
-- people. They are a definition of a process, not a party to it.
--
-- This creates the table. Moving the existing rows is a separate migration:
-- deleting rows out of public.agents needs to be written against what those
-- seven rows actually contain, not against a guess.

create table public.outreach_steps (
  step_number  smallint primary key check (step_number between 1 and 50),

  -- Days after the first touch in the sequence. 0 is the same day.
  day_offset   integer not null check (day_offset >= 0),

  -- Null where a step is a reminder rather than a message to send.
  channel      text check (channel in ('call', 'text', 'email', 'note', 'meeting')),

  label        text not null,
  body         text,
  active       boolean not null default true,

  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.outreach_steps is
  'The outreach sequence itself. Distinct from public.settings.follow_up_days,
   which is the gap before an agent comes back around after any touch.';

create index outreach_steps_active_idx on public.outreach_steps (day_offset)
  where active;

create trigger outreach_steps_updated_at before update on public.outreach_steps
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- access
alter table public.outreach_steps enable row level security;

create policy outreach_steps_select on public.outreach_steps for select
  to authenticated using (public.is_goodguys());
create policy outreach_steps_insert on public.outreach_steps for insert
  to authenticated with check (public.is_goodguys());
create policy outreach_steps_update on public.outreach_steps for update
  to authenticated using (public.is_goodguys()) with check (public.is_goodguys());
create policy outreach_steps_delete on public.outreach_steps for delete
  to authenticated using (public.is_goodguys());

grant select, insert, update, delete on public.outreach_steps to authenticated;
