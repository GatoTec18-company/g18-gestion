-- =====================================================================
-- Usuarios propios de la app (tabla public.usuarios)
-- En Supabase el esquema "auth" lo administra Supabase Auth y no se puede
-- modificar; la app maneja su propio inicio de sesión, así que los usuarios
-- pasan a una tabla propia. Las contraseñas se guardan con bcrypt.
-- =====================================================================

create table usuarios (
  id                  uuid primary key default gen_random_uuid(),
  email               text not null,
  clave_hash          text not null,
  debe_cambiar_clave  boolean not null default false,
  creado_en           timestamptz not null default now(),
  ultimo_ingreso      timestamptz
);
create unique index usuarios_email_uq on usuarios (lower(email));

-- Traer los usuarios que ya existían (local). En Supabase la tabla auth.users está vacía y no se copia nada.
do $$
declare tiene_flag boolean;
begin
  select exists (select 1 from information_schema.columns
                 where table_schema = 'auth' and table_name = 'users' and column_name = 'debe_cambiar_clave') into tiene_flag;
  if tiene_flag then
    execute $q$ insert into usuarios (id, email, clave_hash, debe_cambiar_clave, creado_en, ultimo_ingreso)
                select id, email, encrypted_password, debe_cambiar_clave, created_at, last_sign_in_at
                from auth.users where email is not null and encrypted_password is not null $q$;
  end if;
end $$;

-- Todas las referencias a auth.users pasan a public.usuarios (misma regla de borrado)
do $$
declare r record; accion text;
begin
  for r in
    select c.conname, c.conrelid::regclass as tabla, a.attname as columna, c.confdeltype
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.contype = 'f' and c.confrelid = 'auth.users'::regclass
      and c.connamespace = 'public'::regnamespace
  loop
    accion := case r.confdeltype when 'c' then 'cascade' when 'n' then 'set null' else 'no action' end;
    execute format('alter table %s drop constraint %I', r.tabla, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references usuarios(id) on delete %s',
                   r.tabla, r.conname, r.columna, accion);
  end loop;
end $$;

-- Intentos de inicio de sesión (para frenar a quien prueba contraseñas)
create table intentos_login (
  id      bigserial primary key,
  email   text not null,
  exito   boolean not null,
  fecha   timestamptz not null default now()
);
create index intentos_login_idx on intentos_login (lower(email), fecha);

-- Nadie entra a estas tablas por la API pública de Supabase: solo la app desde el servidor
alter table usuarios enable row level security;
alter table intentos_login enable row level security;

-- Funciones que no deben poder llamarse desde la API pública
revoke execute on function siguiente_numero(uuid, text) from public;
revoke execute on function registrar_traslado(uuid, date, uuid, uuid, uuid, numeric, text, uuid) from public;
