-- =====================================================================
-- Usuarios con roles, trazabilidad de ventas y "caja por total del día"
--
-- Decisión del administrador: la caja se lleva con el TOTAL DEL DÍA en el
-- libro diario. Las ventas, abonos y cobros que registra el personal son
-- de CONTROL: no mueven la caja (salvo que la empresa active
-- ventas_mueven_caja en Configuración).
-- =====================================================================

alter type rol_usuario add value if not exists 'vendedor';
alter type rol_usuario add value if not exists 'cajero';

create type estado_revision as enum ('no_aplica', 'pendiente', 'aprobada', 'rechazada');

alter table empresas
  add column ventas_mueven_caja boolean not null default false;

alter table miembros
  add column activo boolean not null default true,
  add column creado_en timestamptz not null default now();

-- ---------------------------------------------------------------------
-- Trazabilidad de ventas
-- ---------------------------------------------------------------------
alter table ventas
  add column producto       text,                    -- equipo vendido (marca, modelo, serial)
  add column registrado_por uuid references auth.users(id) default auth.uid(),
  add column revision       estado_revision not null default 'no_aplica',
  add column revisado_por   uuid references auth.users(id),
  add column revisado_en    timestamptz,
  add column nota_revision  text;
create index ventas_revision_idx on ventas (empresa_id, revision);
create index ventas_registrado_idx on ventas (registrado_por);

alter table venta_pagos
  add column referencia text;   -- N° de aprobación del datáfono, ID del crédito Addi, etc.

-- ---------------------------------------------------------------------
-- Cobros de ventas financiadas y abonos de pedidos (registros de control)
-- ---------------------------------------------------------------------
create table cobros (
  id              uuid primary key default gen_random_uuid(),
  venta_pago_id   uuid not null references venta_pagos(id) on delete cascade,
  fecha           date not null default current_date,
  monto           numeric(14,2) not null check (monto > 0),
  cuenta_id       uuid references cuentas(id),
  nota            text,
  movimiento_id   uuid references movimientos(id) on delete set null,  -- solo si la empresa mueve caja por venta
  registrado_por  uuid references auth.users(id) default auth.uid(),
  creado_en       timestamptz not null default now()
);
create index cobros_vp_idx on cobros (venta_pago_id);

create table pedido_abonos (
  id              uuid primary key default gen_random_uuid(),
  pedido_id       uuid not null references pedidos(id) on delete cascade,
  fecha           date not null default current_date,
  monto           numeric(14,2) not null check (monto > 0),
  cuenta_id       uuid references cuentas(id),
  nota            text,
  movimiento_id   uuid references movimientos(id) on delete set null,
  registrado_por  uuid references auth.users(id) default auth.uid(),
  creado_en       timestamptz not null default now()
);
create index pedido_abonos_idx on pedido_abonos (pedido_id);

alter table cobros enable row level security;
create policy cobros_todo on cobros for all to authenticated
  using (es_miembro((select v.empresa_id from venta_pagos vp join ventas v on v.id = vp.venta_id where vp.id = venta_pago_id)))
  with check (es_miembro((select v.empresa_id from venta_pagos vp join ventas v on v.id = vp.venta_id where vp.id = venta_pago_id)));

alter table pedido_abonos enable row level security;
create policy pedido_abonos_todo on pedido_abonos for all to authenticated
  using (es_miembro((select empresa_id from pedidos where id = pedido_id)))
  with check (es_miembro((select empresa_id from pedidos where id = pedido_id)));

do $$ declare t text;
begin
  foreach t in array array['cobros', 'pedido_abonos'] loop
    execute format('create trigger %I_auditoria after insert or update or delete on %I
                    for each row execute function auditar()', t, t);
  end loop;
end $$;

-- Pagos de contado: solo entran al libro si la empresa lleva la caja venta por venta.
create or replace function venta_pago_a_libro() returns trigger language plpgsql
security definer set search_path = public as $$
declare v ventas;
begin
  if tg_op = 'UPDATE' and (old.forma in ('financiada','credito_directo'))
                       <> (new.forma in ('financiada','credito_directo')) then
    raise exception 'No se puede pasar un pago de contado a crédito (o al revés): bórrelo y créelo de nuevo';
  end if;
  if new.forma in ('financiada', 'credito_directo') then
    return new;
  end if;
  select * into v from ventas where id = new.venta_id;
  if not (select ventas_mueven_caja from empresas where id = v.empresa_id) then
    return new;   -- la caja se lleva con el total del día
  end if;
  if tg_op = 'UPDATE' and exists (select 1 from movimientos where venta_pago_id = new.id) then
    update movimientos set monto = new.monto, cuenta_id = new.cuenta_id, fecha = v.fecha
     where venta_pago_id = new.id;
  else
    insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, tercero_id, venta_pago_id, pedido_id)
    values (v.empresa_id, v.fecha, 'ingreso', new.cuenta_id, new.monto,
            'Venta' || coalesce(' ' || v.numero_factura, ''), v.cliente_id, new.id, v.pedido_id);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- Vistas: lo recibido sale de los registros de control (no del libro)
-- ---------------------------------------------------------------------
drop view v_cuentas_por_cobrar;
create view v_cuentas_por_cobrar with (security_invoker = true) as
with rec as (
  select venta_pago_id, sum(monto) recibido, max(fecha) ultima from cobros group by 1
)
select v.empresa_id, vp.id as venta_pago_id, v.id as venta_id, v.fecha as fecha_venta,
       v.numero_factura, t.nombre as cliente, t.documento, e.nombre as vendedor,
       vp.forma, ef.nombre as entidad, vp.detalle, vp.referencia, v.producto, vp.monto,
       vp.recibido_previo + coalesce(rec.recibido, 0) as recibido,
       vp.monto - vp.recibido_previo - coalesce(rec.recibido, 0) as pendiente,
       vp.fecha_estimada_pago,
       coalesce(rec.ultima, vp.fecha_recibido_previo) as fecha_pago_real,
       vp.aplicado_en_factura, v.revision, v.registrado_por,
       case
         when vp.monto - vp.recibido_previo - coalesce(rec.recibido, 0) <= 0 and vp.aplicado_en_factura then 'Aplicado en factura'
         when vp.monto - vp.recibido_previo - coalesce(rec.recibido, 0) <= 0 then 'Pagado: falta aplicar en factura'
         when vp.fecha_estimada_pago is null then 'Por confirmar'
         when vp.fecha_estimada_pago < current_date then 'Vencido'
         when vp.fecha_estimada_pago <= current_date + 1 then 'Por vencer'
         else 'En plazo'
       end as estado
from venta_pagos vp
join ventas v on v.id = vp.venta_id
left join rec on rec.venta_pago_id = vp.id
left join terceros t on t.id = v.cliente_id
left join empleados e on e.id = v.vendedor_id
left join entidades_financiacion ef on ef.id = vp.entidad_id
where vp.forma in ('financiada', 'credito_directo') and v.revision <> 'rechazada';

drop view v_pedidos;
create view v_pedidos with (security_invoker = true) as
with it as (
  select pedido_id,
         string_agg(descripcion, ' + ' order by descripcion) as producto,
         sum(cantidad * precio_venta)::numeric(14,2) as valor,
         bool_or(precio_venta is null) as falta_valor
  from pedido_items group by pedido_id
), ab as (
  select pedido_id, sum(monto) as abonado from pedido_abonos group by pedido_id
), co as (
  select pedido_id, sum(monto) as costo_pagado
  from movimientos where pedido_id is not null and tipo = 'egreso' group by pedido_id
)
select p.empresa_id, p.id, p.numero, p.fecha_pedido, p.fecha_estimada, p.fecha_entrega_real,
       p.estado, it.producto, it.valor,
       p.abonado_previo + coalesce(ab.abonado, 0) as abonado,
       it.valor - p.abonado_previo - coalesce(ab.abonado, 0) as saldo,
       coalesce(co.costo_pagado, 0) as costo_pagado,
       case when it.valor is not null and co.costo_pagado is not null then it.valor - co.costo_pagado end as utilidad,
       c.nombre as cliente, c.telefono, pr.nombre as proveedor,
       case when p.estado in ('entregado','cancelado') or p.fecha_estimada is null then null
            else p.fecha_estimada - current_date end as dias_para_entrega,
       case
         when p.estado = 'cancelado' then 'CANCELADO'
         when p.estado = 'entregado' then 'OK'
         when coalesce(it.falta_valor, true) then 'FALTA VALOR'
         when p.estado = 'por_pedir' then 'POR PEDIR'
         when p.fecha_estimada < current_date then 'ATRASADO'
         when p.fecha_estimada <= current_date + 2 then 'ENTREGA PRÓXIMA'
         else 'EN PLAZO'
       end as alerta,
       p.observaciones
from pedidos p
left join it on it.pedido_id = p.id
left join ab on ab.pedido_id = p.id
left join co on co.pedido_id = p.id
left join terceros c  on c.id  = p.cliente_id
left join terceros pr on pr.id = p.proveedor_id;
