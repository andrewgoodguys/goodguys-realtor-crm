-- 0014's backstop did not work, and 0015 proved it. Replace it with one that
-- can be checked.
--
-- 0014 ended with
--
--   alter default privileges in schema public revoke execute on functions from public;
--
-- and a comment claiming that stops the next migration reopening the hole. It
-- does not. On Supabase `pg_default_acl` carries an entry for
-- (defaclrole=postgres, schema=public, functions) that grants EXECUTE to
-- `anon`, `authenticated` and `service_role` by name. Revoking from PUBLIC
-- removes the implicit default and leaves every one of those named grants
-- standing, so the next function written — is_contact_channel(), in 0015 —
-- came out executable by `anon` regardless.
--
-- That one is harmless: an immutable predicate over a string it is handed,
-- the same class as in_intro_sequence(). The mechanism is what needed fixing.
-- What actually shut the functions in 0014 was the explicit REVOKE written
-- beside each one, and that remains the rule:
--
--   A new `security definer` function gets its own REVOKE and its own guard.
--   Nothing about the schema's defaults will do it for you.
--
-- So instead of a default nobody can see working, this migration ends with an
-- assertion that fails the next `db push` if the rule is ever broken.

-- ------------------------------------------------------------------ sweep it
-- Everything owner-privileged in this schema, in one pass, rather than a list
-- that has to be kept up to date. Trigger functions are included and unharmed:
-- EXECUTE on a trigger function is checked when the trigger is created, not
-- each time it fires.
do $$
declare
  f record;
begin
  for f in
    select p.oid::regprocedure as sig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prosecdef
  loop
    execute format('revoke all on function %s from public, anon', f.sig);
  end loop;
end
$$;

-- Not security definer, so RLS answers for anything it touches — but a
-- signed-out visitor has no use for it either, and contact_scoreboard is read
-- by `authenticated`.
revoke all on function public.is_contact_channel(text) from public, anon;
grant execute on function public.is_contact_channel(text) to authenticated;

-- Kept, because it costs nothing and removes one of the two ways in. It is
-- documented above as insufficient on its own rather than deleted, so nobody
-- re-adds it thinking it was missed.
alter default privileges in schema public
  revoke execute on functions from public, anon;

-- ------------------------------------------------------------------ prove it
-- The invariant, stated once: nothing that runs with RLS switched off is
-- reachable by a signed-out caller. A future migration that adds a definer
-- function and forgets its REVOKE fails here, by name, instead of shipping.
do $$
declare
  leaked text;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.oid::regprocedure::text)
    into leaked
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'execute');

  if leaked is not null then
    raise exception
      'anon can execute security-definer functions in public: %. Add '
      '`revoke all on function <sig> from public, anon;` beside each one.',
      leaked;
  end if;
end
$$;
