-- Solo local (en Supabase esto lo maneja Supabase Auth).
alter table auth.users add column if not exists debe_cambiar_clave boolean not null default false;
