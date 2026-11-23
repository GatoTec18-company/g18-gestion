-- =====================================================================
-- Deudas con proveedores y bancos, y cierre de mes
-- =====================================================================

-- ---------- Proveedores: para qué fue cada compra a crédito ----------
alter table facturas_proveedor
  add column destino text not null default 'mercancia'
    check (destino in ('mercancia', 'pedido_cliente', 'activos', 'saldo_inicial', 'otro'));

-- ---------- Créditos y deudas financieras (bancos, tarjetas, préstamos) ----------
create table creditos (
  id            uuid primary key default gen_random_uuid(),
  empresa_id    uuid not null references empresas(id) on delete cascade,
  entidad       text not null,                       -- Banco Agrario, Bancolombia…
  tipo          text not null default 'credito' check (tipo in ('credito', 'tarjeta', 'prestamo', 'otro')),
  descripcion   text,
  saldo_inicial numeric(14,2) not null check (saldo_inicial >= 0),  -- lo que se debía al empezar a llevarlo aquí
  fecha_inicial date not null default current_date,
  cuota         numeric(14,2) check (cuota >= 0),
  dia_pago      int check (dia_pago between 1 and 31),
  activo        boolean not null default true,
  creado_en     timestamptz not null default now()
);

-- Lo que aumenta la deuda: compras con la tarjeta, nuevos desembolsos, intereses cargados
create table credito_cargos (
  id          uuid primary key default gen_random_uuid(),
  credito_id  uuid not null references creditos(id) on delete cascade,
  fecha       date not null default current_date,
  monto       numeric(14,2) not null check (monto > 0),
  concepto    text not null,
  destino     text not null default 'otro' check (destino in ('mercancia', 'pedido_cliente', 'activos', 'otro')),
  registrado_por uuid references usuarios(id) default auth.uid(),
  creado_en   timestamptz not null default now()
);
create index credito_cargos_idx on credito_cargos (credito_id);

-- Los pagos son egresos del libro diario ligados al crédito
alter table movimientos add column credito_id uuid references creditos(id);
create index movimientos_credito_idx on movimientos (credito_id);

create view v_creditos with (security_invoker = true) as
select c.*,
       coalesce((select sum(monto) from credito_cargos g where g.credito_id = c.id), 0) as cargos,
       coalesce((select sum(monto) from movimientos m where m.credito_id = c.id and m.tipo = 'egreso'), 0) as pagado,
       c.saldo_inicial
         + coalesce((select sum(monto) from credito_cargos g where g.credito_id = c.id), 0)
         - coalesce((select sum(monto) from movimientos m where m.credito_id = c.id and m.tipo = 'egreso'), 0) as saldo
from creditos c;

-- ---------- Seguridad y auditoría de lo nuevo ----------
alter table creditos enable row level security;
create policy creditos_ver on creditos for select to authenticated using (es_miembro(empresa_id));
create policy creditos_crear on creditos for insert to authenticated with check (es_miembro(empresa_id));
create policy creditos_editar on creditos for update to authenticated using (es_miembro(empresa_id)) with check (es_miembro(empresa_id));
create policy creditos_borrar on creditos for delete to authenticated using (es_admin(empresa_id));

alter table credito_cargos enable row level security;
create policy credito_cargos_todo on credito_cargos for all to authenticated
  using (es_miembro((select empresa_id from creditos where id = credito_id)))
  with check (es_miembro((select empresa_id from creditos where id = credito_id)));

do $$ declare t text;
begin
  foreach t in array array['creditos', 'credito_cargos', 'cierres_mes'] loop
    execute format('create trigger %I_auditoria after insert or update or delete on %I
                    for each row execute function auditar()', t, t);
  end loop;
end $$;
