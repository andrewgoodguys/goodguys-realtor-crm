-- Settings the app can change without a migration, and an owner list that is
-- data rather than a CHECK constraint.
--
-- Three things move out of code and into Postgres here:
--   * outreach copy, which was duplicated in src/lib/templates.ts and
--     pipeline/messages.py and had to be edited in both places;
--   * the +30 day follow-up gap, which was baked into sync_agent_touch();
--   * the Andrew/Avery owner list, which was a CHECK constraint.

-- ---------------------------------------------------------------- people
create table public.people (
  name        text primary key,
  active      boolean not null default true,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now()
);

comment on table public.people is
  'Who agents can be assigned to. Mirrors OWNERS in pipeline/config.py.';

insert into public.people (name, sort_order) values ('Andrew', 1), ('Avery', 2);

-- owner_name was locked to ('Andrew','Avery') by a CHECK. An FK makes the list
-- editable, and ON UPDATE CASCADE means renaming a person carries their agents
-- along instead of orphaning them.
alter table public.agents   drop constraint agents_owner_name_check;
alter table public.profiles drop constraint profiles_owner_name_check;

alter table public.agents
  add constraint agents_owner_fk foreign key (owner_name)
  references public.people(name) on update cascade on delete set null;

alter table public.profiles
  add constraint profiles_owner_fk foreign key (owner_name)
  references public.people(name) on update cascade on delete set null;

-- ---------------------------------------------------------------- settings
-- One row, forever: `id` is a boolean pinned true, so a second row cannot be
-- inserted and every query is `where id`.
create table public.settings (
  id                 boolean primary key default true check (id),

  -- branding
  app_name           text not null default 'GoodGuys Realtor CRM',
  logo_url           text,
  accent_color       text not null default '#158253'   -- GoodGuys green
                       check (accent_color ~ '^#[0-9a-fA-F]{6}$'),
  login_blurb        text not null default 'Sign in with your @goodguysserve.com email',

  -- cadence
  follow_up_days     integer not null default 30
                       check (follow_up_days between 1 and 365),
  -- 0 reproduces 0001's behaviour exactly: due today or overdue, nothing more.
  due_window_days    integer not null default 7
                       check (due_window_days between 0 and 90),
  default_owner      text references public.people(name)
                       on update cascade on delete set null,

  -- outreach copy. Placeholders: {{first_name}} {{client_name}} {{client_role}}
  -- {{direction}} {{address}} {{signature}} and, in the repeat beat, {{ordinal}}.
  signature          text not null,
  text_template      text not null,
  email_subject      text not null,
  email_body         text not null,
  call_script        text not null,   -- one spoken beat per line
  call_script_repeat text not null,

  updated_at         timestamptz not null default now(),
  updated_by         uuid references auth.users(id)
);

comment on table public.settings is
  'Single-row app configuration. Defaults reproduce the wording that was
   hardcoded in src/lib/templates.ts, so seeding changes no outgoing message.';

-- Defaults are the exact strings templates.ts shipped with; templates.test.ts
-- pins them, so a change here that alters wording will fail that test.
insert into public.settings (
  id, signature, text_template, email_subject, email_body,
  call_script, call_script_repeat
) values (
  true,
  $tpl$Andrew Johnson
Co-Founder, GoodGuys Concierge Moving & Storage$tpl$,

  $tpl$Hi {{first_name}} — Andrew with GoodGuys Concierge Moving & Storage in Atlanta. We just moved your {{client_role}} {{client_name}} {{direction}} {{address}}. Good day, happy client. If you ever need a mover you can hand off without worrying, we'd like to be that for you.$tpl$,

  $tpl$We moved your {{client_role}} {{client_name}}$tpl$,

  $tpl$Hi {{first_name}},

We recently moved your {{client_role}} {{client_name}} {{direction}} {{address}}. They finished the day happy.

I'll keep this short. When a move goes badly, it lands back on the agent who recommended the mover. We'd like to be the one you can refer with confidence — the crew shows up when we say, the price holds, and your client thanks you afterward.

If that's useful, I'm easy to reach and happy to be a resource whether or not it turns into anything.

{{signature}}$tpl$,

  $tpl$Hi {{first_name}}, this is Andrew with GoodGuys Concierge Moving and Storage here in Atlanta.
Quick call. We just moved your {{client_role}} {{client_name}} {{direction}} {{address}}.
The day went smoothly and they were happy at the end of it. That's the part I care about.
I'm calling because you're the reason that move happened, and we'd like to be the mover you can hand to your next client without thinking twice.
We make you look good. That's the whole pitch.
Can I send you our direct line, so you have it when you need it?$tpl$,

  $tpl$That's actually the {{ordinal}} client of yours we've moved now.$tpl$
);

create trigger settings_updated_at before update on public.settings
  for each row execute function public.touch_updated_at();

-- The login screen renders before anyone is authenticated, so it cannot read
-- public.settings through RLS. This view exposes only the four cosmetic
-- columns and is deliberately readable by anon; nothing here is a secret.
create view public.branding as
  select app_name, logo_url, accent_color, login_blurb
    from public.settings where id;

grant select on public.branding to anon, authenticated;

-- ------------------------------------------------------- cadence in the trigger
-- Same as 0001 except the +30 is now settings.follow_up_days.
create or replace function public.sync_agent_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  target uuid := coalesce(new.agent_id, old.agent_id);
  latest date;
  gap    integer;
begin
  select follow_up_days into gap from public.settings where id;
  gap := coalesce(gap, 30);

  select max(occurred_at)::date into latest
    from public.touches where agent_id = target;

  update public.agents
     set last_touch     = latest,
         next_touch_due = case when latest is null then null else latest + gap end,
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

-- Changing the cadence should move every open follow-up, not only the next one
-- logged. The app calls this after follow_up_days changes.
create or replace function public.reschedule_follow_ups()
returns void
language sql
security definer
set search_path = public
as $fn$
  update public.agents
     set next_touch_due = last_touch + (select follow_up_days from public.settings where id)
   where last_touch is not null;
$fn$;

-- ------------------------------------------------------- the look-ahead window
-- 0001 hardcoded "due today or overdue". Same view, with the horizon read from
-- settings so the call list can look further ahead.
create or replace view public.due_this_week
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
  and (a.next_touch_due is null
       or a.next_touch_due
          <= current_date + (select due_window_days from public.settings where id));

-- ---------------------------------------------------------------- access
alter table public.people   enable row level security;
alter table public.settings enable row level security;

create policy people_select on public.people for select
  to authenticated using (public.is_goodguys());
create policy people_insert on public.people for insert
  to authenticated with check (public.is_goodguys());
create policy people_update on public.people for update
  to authenticated using (public.is_goodguys()) with check (public.is_goodguys());

-- Settings is one row: readable and updatable, never inserted or deleted.
create policy settings_select on public.settings for select
  to authenticated using (public.is_goodguys());
create policy settings_update on public.settings for update
  to authenticated using (public.is_goodguys()) with check (public.is_goodguys());

grant select, insert, update on public.people to authenticated;
grant select, update on public.settings to authenticated;
grant execute on function public.reschedule_follow_ups() to authenticated;
