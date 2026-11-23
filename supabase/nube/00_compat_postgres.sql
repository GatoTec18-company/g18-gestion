-- =====================================================================
-- Compatibilidad para un PostgreSQL en la nube que NO es Supabase (p. ej. Neon).
-- Crea lo mínimo que Supabase trae y que las migraciones mencionan:
-- roles anon/authenticated, esquema auth, auth.users y auth.uid().
-- scripts/nube.mjs lo aplica solo si el esquema "auth" no existe.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text,
  created_at          timestamptz not null default now(),
  last_sign_in_at     timestamptz
);

create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated;
grant execute on function auth.uid() to anon, authenticated;
