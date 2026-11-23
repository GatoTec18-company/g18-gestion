-- =====================================================================
-- Datos de la empresa para recibos, préstamos entre las dos empresas
-- y plata que nos deben personas (anticipos, préstamos, crédito directo)
-- =====================================================================

-- Los préstamos no son ventas ni gastos: mueven la caja pero no cuentan en los reportes
alter type clase_movimiento add value if not exists 'prestamo';

alter table empresas
  add column telefono   text,
  add column direccion  text,
  add column ciudad     text,
  add column pie_recibo text;

-- Una empresa le pasa plata a la otra (o le devuelve). Crea un egreso en una y un ingreso en la otra.
create table prestamos_empresas (
  id             uuid primary key default gen_random_uuid(),
  fecha          date not null default current_date,
  de_empresa     uuid not null references empresas(id) on delete cascade,
  a_empresa      uuid not null references empresas(id) on delete cascade,
  monto          numeric(14,2) not null check (monto > 0),
  concepto       text not null,
  mov_sale       uuid references movimientos(id) on delete set null,
  mov_entra      uuid references movimientos(id) on delete set null,
  registrado_por uuid references usuarios(id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  check (de_empresa <> a_empresa)
);
create index prestamos_empresas_idx on prestamos_empresas (de_empresa, a_empresa, fecha);

-- Plata que nos deben personas: anticipos a empleados, préstamos, clientes a crédito directo
create table por_cobrar (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  persona        text not null,
  tipo           text not null default 'otro' check (tipo in ('empleado', 'cliente', 'otro')),
  concepto       text not null,
  monto          numeric(14,2) not null check (monto > 0),
  fecha          date not null default current_date,
  fecha_esperada date,
  movimiento_id  uuid references movimientos(id) on delete set null,   -- si la plata salió de la caja
  registrado_por uuid references usuarios(id) default auth.uid(),
  creado_en      timestamptz not null default now()
);
create index por_cobrar_idx on por_cobrar (empresa_id, fecha);

create table por_cobrar_pagos (
  id             uuid primary key default gen_random_uuid(),
  por_cobrar_id  uuid not null references por_cobrar(id) on delete cascade,
  fecha          date not null default current_date,
  monto          numeric(14,2) not null check (monto > 0),
  nota           text,
  movimiento_id  uuid references movimientos(id) on delete set null,   -- si la plata entró a la caja
  registrado_por uuid references usuarios(id) default auth.uid(),
  creado_en      timestamptz not null default now()
);
create index por_cobrar_pagos_idx on por_cobrar_pagos (por_cobrar_id);

create view v_por_cobrar with (security_invoker = true) as
select c.*, coalesce(p.pagado, 0) as pagado, c.monto - coalesce(p.pagado, 0) as saldo, p.ultimo_pago
from por_cobrar c
left join (select por_cobrar_id, sum(monto) pagado, max(fecha) ultimo_pago from por_cobrar_pagos group by 1) p on p.por_cobrar_id = c.id;

-- ---------- Seguridad y auditoría ----------
alter table prestamos_empresas enable row level security;
create policy prestamos_empresas_todo on prestamos_empresas for all to authenticated
  using (es_miembro(de_empresa) or es_miembro(a_empresa)) with check (es_miembro(de_empresa) and es_miembro(a_empresa));
alter table por_cobrar enable row level security;
create policy por_cobrar_todo on por_cobrar for all to authenticated
  using (es_miembro(empresa_id)) with check (es_miembro(empresa_id));
alter table por_cobrar_pagos enable row level security;
create policy por_cobrar_pagos_todo on por_cobrar_pagos for all to authenticated
  using (es_miembro((select empresa_id from por_cobrar where id = por_cobrar_id)))
  with check (es_miembro((select empresa_id from por_cobrar where id = por_cobrar_id)));

do $$ declare t text;
begin
  foreach t in array array['prestamos_empresas', 'por_cobrar', 'por_cobrar_pagos'] loop
    execute format('create trigger %I_auditoria after insert or update or delete on %I
                    for each row execute function auditar()', t, t);
  end loop;
end $$;
