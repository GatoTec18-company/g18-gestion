-- =====================================================================
-- Capa local que imita lo que Supabase ya trae (solo para la base local).
-- NO se sube a Supabase: allá estos objetos ya existen.
-- Permite que las migraciones de supabase/migrations funcionen sin cambios.
-- =====================================================================

do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon')          then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role')  then create role service_role nologin bypassrls; end if;
end $$;

create extension if not exists pgcrypto;   -- para guardar contraseñas con bcrypt (crypt/gen_salt)

create schema if not exists auth;

-- Usuarios (equivalente reducido de auth.users de Supabase)
create table if not exists auth.users (
  id                  uuid primary key default gen_random_uuid(),
  email               text unique,
  encrypted_password  text,
  created_at          timestamptz not null default now(),
  last_sign_in_at     timestamptz
);

-- Igual que en Supabase: el usuario actual sale del "claim" sub del token.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
