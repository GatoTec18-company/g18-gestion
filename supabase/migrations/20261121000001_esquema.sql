-- =====================================================================
-- G18 Gestión · Esquema unificado (PostgreSQL / Supabase)
-- Reemplaza: app de escritorio (3 bases SQLite) + Google Sheets
--   · Libro diario mensual (bolsillos, egresos, CxC, proveedores,
--     cronograma de pagos, cuadre de caja, cierre y traspaso de mes)
--   · Productos bajo encargo
--   · Control de ventas financiadas (Addi, Sumas Pay, Cooperativa, Tarjeta)
-- Multiempresa: G18 Corporation SAS y Gatotec 18 comparten la app,
-- cada registro pertenece a una empresa.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type rol_usuario        as enum ('admin', 'colaborador');
create type tipo_cuenta        as enum ('efectivo', 'banco', 'billetera', 'caja_menor');
create type tipo_gasto         as enum ('proveedores', 'inversion', 'gasto_fijo', 'gasto_variable',
                                        'nomina', 'deuda_financieros', 'impuestos_bancarios', 'otros');
create type tipo_movimiento    as enum ('ingreso', 'egreso');
create type clase_movimiento   as enum ('operacion', 'saldo_inicial', 'traslado', 'ajuste');
create type regla_pago_entidad as enum ('dias_calendario', 'dia_fijo_mes', 'dias_habiles', 'sin_fecha');
create type forma_pago_venta   as enum ('efectivo', 'transferencia', 'tarjeta_debito', 'financiada', 'credito_directo');
create type estado_pedido      as enum ('por_pedir', 'pedido', 'en_camino', 'recibido_en_tienda', 'entregado', 'cancelado');

-- ---------------------------------------------------------------------
-- Empresas, usuarios y permisos
-- ---------------------------------------------------------------------
create table empresas (
  id          uuid primary key default gen_random_uuid(),
  nombre      text not null unique,
  nit         text,
  logo_url    text,
  creado_en   timestamptz not null default now()
);

-- Un usuario (Supabase Auth) puede pertenecer a una o a las dos empresas.
-- Los permisos son por persona y por módulo (no por rol, como en la app vieja).
create table miembros (
  user_id     uuid not null references auth.users(id) on delete cascade,
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  rol         rol_usuario not null default 'colaborador',
  permisos    jsonb not null default '{}'::jsonb,   -- {"libro":true,"proveedores":false,...}
  primary key (user_id, empresa_id)
);

-- Personas que aparecen como vendedor o en nómina (no necesitan usuario).
create table empleados (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  user_id     uuid references auth.users(id) on delete set null,
  activo      boolean not null default true,
  unique (empresa_id, nombre)
);

-- ---------------------------------------------------------------------
-- Configuración financiera
-- ---------------------------------------------------------------------
-- Dónde está la plata: caja, caja menor, Bancolombia, Nequi, Daviplata...
create table cuentas (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  tipo        tipo_cuenta not null,
  activa      boolean not null default true,
  unique (empresa_id, nombre)
);

-- Bolsillos: 75 Proveedores · 10A Gastos fijos · 10B Deuda · 5 Ahorro (configurable)
create table bolsillos (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  codigo      text not null,
  nombre      text not null,
  porcentaje  numeric(5,2) not null check (porcentaje >= 0 and porcentaje <= 100),
  orden       int not null default 0,
  unique (empresa_id, codigo)
);

create table categorias_gasto (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  tipo        tipo_gasto not null,
  guia        text,                       -- "cuándo usar esta categoría"
  activa      boolean not null default true,
  unique (empresa_id, nombre)
);

create table metas_mes (
  empresa_id   uuid not null references empresas(id) on delete cascade,
  mes          date not null check (mes = date_trunc('month', mes)::date),
  meta_ventas  numeric(14,2) not null check (meta_ventas >= 0),
  primary key (empresa_id, mes)
);

create table festivos (
  fecha   date primary key,
  nombre  text not null
);

-- ---------------------------------------------------------------------
-- Terceros: clientes y proveedores en una sola tabla
-- ---------------------------------------------------------------------
create table terceros (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  nombre         text not null,
  documento      text,                    -- cédula o NIT
  telefono       text,
  correo         text,
  direccion      text,
  es_cliente     boolean not null default false,
  es_proveedor   boolean not null default false,
  cupo_credito   numeric(14,2),           -- solo proveedores
  banco          text,
  tipo_cuenta    text,
  numero_cuenta  text,
  convenio       text,
  notas          text,
  creado_en      timestamptz not null default now(),
  check (es_cliente or es_proveedor)
);
create unique index terceros_documento_uq on terceros (empresa_id, documento) where documento is not null;
create index terceros_nombre_idx on terceros (empresa_id, lower(nombre));

-- ---------------------------------------------------------------------
-- Entidades de financiación y reglas de pago
-- ---------------------------------------------------------------------
create table entidades_financiacion (
  id          uuid primary key default gen_random_uuid(),
  empresa_id  uuid not null references empresas(id) on delete cascade,
  nombre      text not null,
  regla       regla_pago_entidad not null,
  valor       int,          -- días (calendario/hábiles) o día del mes en que pagan
  dia_corte   int check (dia_corte between 1 and 31),  -- solo dia_fijo_mes
  nota        text,
  activa      boolean not null default true,
  unique (empresa_id, nombre),
  check (regla = 'sin_fecha' or valor is not null)
);

create function sumar_dias_habiles(desde date, n int) returns date
language plpgsql stable as $$
declare d date := desde; k int := 0;
begin
  while k < n loop
    d := d + 1;
    if extract(isodow from d) < 6 and not exists (select 1 from festivos f where f.fecha = d) then
      k := k + 1;
    end if;
  end loop;
  return d;
end $$;

create function fecha_estimada_pago(p_entidad uuid, p_fecha_venta date) returns date
language plpgsql stable as $$
declare e entidades_financiacion; base date;
begin
  select * into e from entidades_financiacion where id = p_entidad;
  if not found then return null; end if;
  case e.regla
    when 'dias_calendario' then return p_fecha_venta + e.valor;
    when 'dias_habiles'    then return sumar_dias_habiles(p_fecha_venta, e.valor);
    when 'dia_fijo_mes'    then
      -- antes del corte: paga el día X del mes siguiente; desde el corte: el día X del subsiguiente
      base := date_trunc('month', p_fecha_venta)::date + interval '1 month';
      if e.dia_corte is not null and extract(day from p_fecha_venta) >= e.dia_corte then
        base := base + interval '1 month';
      end if;
      return base + (e.valor - 1);
    else return null;
  end case;
end $$;

-- ---------------------------------------------------------------------
-- Pedidos bajo encargo
-- ---------------------------------------------------------------------
create table secuencias (
  empresa_id  uuid not null references empresas(id) on delete cascade,
  tipo        text not null,
  ultimo      int not null default 0,
  primary key (empresa_id, tipo)
);

create function siguiente_numero(p_empresa uuid, p_tipo text) returns int
language plpgsql as $$
declare n int;
begin
  insert into secuencias (empresa_id, tipo, ultimo) values (p_empresa, p_tipo, 1)
  on conflict (empresa_id, tipo) do update set ultimo = secuencias.ultimo + 1
  returning ultimo into n;
  return n;
end $$;

create table pedidos (
  id                  uuid primary key default gen_random_uuid(),
  empresa_id          uuid not null references empresas(id) on delete cascade,
  numero              text not null,
  fecha_pedido        date not null default current_date,
  fecha_estimada      date,
  fecha_entrega_real  date,
  cliente_id          uuid references terceros(id),
  proveedor_id        uuid references terceros(id),
  estado              estado_pedido not null default 'por_pedir',
  observaciones       text,
  creado_en           timestamptz not null default now(),
  unique (empresa_id, numero)
);

create table pedido_items (
  id            uuid primary key default gen_random_uuid(),
  pedido_id     uuid not null references pedidos(id) on delete cascade,
  descripcion   text not null,
  cantidad      numeric(10,2) not null default 1 check (cantidad > 0),
  precio_venta  numeric(14,2) check (precio_venta >= 0),   -- puede quedar vacío: "falta valor"
  costo         numeric(14,2) check (costo >= 0)
);

create function pedidos_numerar() returns trigger language plpgsql as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := 'PED-' || lpad(siguiente_numero(new.empresa_id, 'pedido')::text, 3, '0');
  end if;
  if new.estado = 'entregado' and new.fecha_entrega_real is null then
    new.fecha_entrega_real := current_date;
  end if;
  return new;
end $$;
create trigger pedidos_numerar before insert or update on pedidos
  for each row execute function pedidos_numerar();

-- ---------------------------------------------------------------------
-- Ventas (venta por venta; también admite un total del día sin cliente)
-- ---------------------------------------------------------------------
create table ventas (
  id              uuid primary key default gen_random_uuid(),
  empresa_id      uuid not null references empresas(id) on delete cascade,
  fecha           date not null default current_date,
  numero_factura  text,
  vendedor_id     uuid references empleados(id),
  cliente_id      uuid references terceros(id),
  pedido_id       uuid references pedidos(id),
  total           numeric(14,2) not null check (total >= 0),
  observaciones   text,
  creado_en       timestamptz not null default now()
);
create unique index ventas_factura_uq on ventas (empresa_id, numero_factura) where numero_factura is not null;
create index ventas_fecha_idx on ventas (empresa_id, fecha);

-- Cómo se pagó cada venta. Contado → genera su ingreso solo.
-- Financiada / crédito directo → queda como cuenta por cobrar hasta que llegue la plata.
create table venta_pagos (
  id                   uuid primary key default gen_random_uuid(),
  venta_id             uuid not null references ventas(id) on delete cascade,
  forma                forma_pago_venta not null,
  monto                numeric(14,2) not null check (monto > 0),
  cuenta_id            uuid references cuentas(id),               -- contado: dónde entró
  entidad_id           uuid references entidades_financiacion(id),-- financiada
  detalle              text,                                      -- MARKETPLACE, TIENDA FÍSICA, BANCO...
  fecha_estimada_pago  date,
  aplicado_en_factura  boolean not null default false,
  check (forma not in ('efectivo','transferencia','tarjeta_debito') or cuenta_id is not null),
  check (forma <> 'financiada' or entidad_id is not null)
);
create index venta_pagos_venta_idx on venta_pagos (venta_id);

-- ---------------------------------------------------------------------
-- Proveedores: facturas a crédito (lo que se debe)
-- ---------------------------------------------------------------------
create table facturas_proveedor (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  proveedor_id       uuid not null references terceros(id),
  numero             text,
  fecha              date not null default current_date,
  fecha_vencimiento  date,
  monto              numeric(14,2) not null check (monto > 0),
  pedido_id          uuid references pedidos(id),
  observaciones      text,
  creado_en          timestamptz not null default now()
);
create index facturas_proveedor_idx on facturas_proveedor (empresa_id, proveedor_id);

-- ---------------------------------------------------------------------
-- Gastos fijos (reemplaza CRONOGRAMA DE PAGOS; sin palabras clave)
-- ---------------------------------------------------------------------
create table gastos_fijos (
  id               uuid primary key default gen_random_uuid(),
  empresa_id       uuid not null references empresas(id) on delete cascade,
  concepto         text not null,
  dia_pago         int check (dia_pago between 1 and 31),     -- vacío = sin fecha fija
  monto_previsto   numeric(14,2) not null check (monto_previsto >= 0),
  categoria_id     uuid references categorias_gasto(id),
  bolsillo_id      uuid references bolsillos(id),
  tercero_id       uuid references terceros(id),
  activo           boolean not null default true,
  unique (empresa_id, concepto)
);

-- ---------------------------------------------------------------------
-- LIBRO DIARIO: todos los movimientos de plata
-- ---------------------------------------------------------------------
create table movimientos (
  id                 uuid primary key default gen_random_uuid(),
  empresa_id         uuid not null references empresas(id) on delete cascade,
  fecha              date not null default current_date,
  tipo               tipo_movimiento not null,
  clase              clase_movimiento not null default 'operacion',
  cuenta_id          uuid not null references cuentas(id),
  monto              numeric(14,2) not null check (monto > 0),
  concepto           text not null,
  categoria_id       uuid references categorias_gasto(id),
  bolsillo_id        uuid references bolsillos(id),   -- egreso: de dónde sale. ingreso: vacío = se reparte
  tercero_id         uuid references terceros(id),
  -- Vínculos explícitos (reemplazan la búsqueda por nombre en el texto)
  venta_pago_id      uuid references venta_pagos(id) on delete cascade,
  pedido_id          uuid references pedidos(id),
  gasto_fijo_id      uuid references gastos_fijos(id),
  traslado_id        uuid,                            -- une las dos patas de un traslado
  comprobante_url    text,
  creado_por         uuid references auth.users(id) default auth.uid(),
  creado_en          timestamptz not null default now(),
  constraint egreso_requiere_bolsillo check (tipo = 'ingreso' or bolsillo_id is not null or clase <> 'operacion'),
  constraint traslado_requiere_id check (clase <> 'traslado' or traslado_id is not null)
);
create index movimientos_fecha_idx   on movimientos (empresa_id, fecha);
create index movimientos_tercero_idx on movimientos (tercero_id);
create index movimientos_pedido_idx  on movimientos (pedido_id);
create index movimientos_vp_idx      on movimientos (venta_pago_id);
create index movimientos_gf_idx      on movimientos (gasto_fijo_id);

-- Cómo afecta cada movimiento a los bolsillos (se llena solo).
create table movimiento_bolsillos (
  movimiento_id  uuid not null references movimientos(id) on delete cascade,
  bolsillo_id    uuid not null references bolsillos(id),
  monto          numeric(14,2) not null,   -- + entra al bolsillo, − sale
  primary key (movimiento_id, bolsillo_id)
);

create function repartir_bolsillos() returns trigger language plpgsql as $$
declare signo int := case when new.tipo = 'ingreso' then 1 else -1 end;
        restante numeric(14,2); b record; parte numeric(14,2); ultimo uuid;
begin
  delete from movimiento_bolsillos where movimiento_id = new.id;
  if new.bolsillo_id is not null then
    insert into movimiento_bolsillos values (new.id, new.bolsillo_id, signo * new.monto);
  elsif new.tipo = 'ingreso' then
    -- reparte por porcentaje; el último bolsillo absorbe el redondeo
    restante := new.monto;
    select id into ultimo from bolsillos where empresa_id = new.empresa_id order by orden desc, codigo desc limit 1;
    for b in select id, porcentaje from bolsillos where empresa_id = new.empresa_id order by orden, codigo loop
      if b.id = ultimo then parte := restante;
      else parte := round(new.monto * b.porcentaje / 100, 2); restante := restante - parte; end if;
      insert into movimiento_bolsillos values (new.id, b.id, parte);
    end loop;
  end if;
  return new;
end $$;
create trigger movimientos_repartir after insert or update of monto, tipo, bolsillo_id on movimientos
  for each row execute function repartir_bolsillos();

-- Un pago de contado de una venta genera (y mantiene) su ingreso en el libro.
create function venta_pago_a_libro() returns trigger language plpgsql as $$
declare v ventas;
begin
  if tg_op = 'UPDATE' and (old.forma in ('financiada','credito_directo'))
                       <> (new.forma in ('financiada','credito_directo')) then
    raise exception 'No se puede pasar un pago de contado a crédito (o al revés): bórrelo y créelo de nuevo';
  end if;
  if new.forma in ('financiada', 'credito_directo') then
    return new;   -- la plata se registra cuando llegue (movimiento con venta_pago_id)
  end if;
  select * into v from ventas where id = new.venta_id;
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
create trigger venta_pagos_libro after insert or update on venta_pagos
  for each row execute function venta_pago_a_libro();

create function venta_pago_fecha_estimada() returns trigger language plpgsql as $$
begin
  if new.forma = 'financiada' and new.fecha_estimada_pago is null then
    new.fecha_estimada_pago := fecha_estimada_pago(new.entidad_id, (select fecha from ventas where id = new.venta_id));
  end if;
  return new;
end $$;
create trigger venta_pagos_fecha before insert or update on venta_pagos
  for each row execute function venta_pago_fecha_estimada();

-- Traslado entre cuentas (ej. consignar efectivo en el banco): dos movimientos unidos.
create function registrar_traslado(p_empresa uuid, p_fecha date, p_origen uuid, p_destino uuid,
                                   p_bolsillo uuid, p_monto numeric, p_concepto text,
                                   p_bolsillo_destino uuid default null)
returns uuid language plpgsql as $$
declare t uuid := gen_random_uuid();
begin
  insert into movimientos (empresa_id, fecha, tipo, clase, cuenta_id, monto, concepto, bolsillo_id, traslado_id)
  values (p_empresa, p_fecha, 'egreso',  'traslado', p_origen,  p_monto, p_concepto, p_bolsillo, t),
         (p_empresa, p_fecha, 'ingreso', 'traslado', p_destino, p_monto, p_concepto, coalesce(p_bolsillo_destino, p_bolsillo), t);
  return t;
end $$;

-- ---------------------------------------------------------------------
-- Cuadre de caja y cierre de mes
-- ---------------------------------------------------------------------
create table cuadres_caja (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  fecha          date not null default current_date,
  cuenta_id      uuid not null references cuentas(id),
  saldo_libro    numeric(14,2) not null,
  saldo_contado  numeric(14,2) not null,
  diferencia     numeric(14,2) generated always as (saldo_contado - saldo_libro) stored,
  nota           text,
  hecho_por      uuid references auth.users(id) default auth.uid(),
  creado_en      timestamptz not null default now()
);

-- Foto del mes (reemplaza TRASPASO MES + HISTÓRICO). NO borra movimientos.
create table cierres_mes (
  empresa_id              uuid not null references empresas(id) on delete cascade,
  mes                     date not null check (mes = date_trunc('month', mes)::date),
  ventas                  numeric(14,2) not null,
  egresos                 numeric(14,2) not null,
  flujo_neto              numeric(14,2) not null,
  saldo_real              numeric(14,2) not null,
  compras_bolsillo_75     numeric(14,2),
  gastos_operativos       numeric(14,2),
  cartera_pendiente       numeric(14,2),
  proveedores_pendientes  numeric(14,2),
  inventario_final        numeric(14,2),
  detalle                 jsonb not null default '{}'::jsonb,   -- saldos por bolsillo y cuenta
  cerrado_por             uuid references auth.users(id) default auth.uid(),
  cerrado_en              timestamptz not null default now(),
  primary key (empresa_id, mes)
);

-- Un mes cerrado queda bloqueado: no se puede crear, cambiar ni borrar movimientos en él.
create function bloquear_mes_cerrado() returns trigger language plpgsql as $$
declare r movimientos;
begin
  r := coalesce(new, old);
  if exists (select 1 from cierres_mes c where c.empresa_id = r.empresa_id and c.mes = date_trunc('month', r.fecha)::date)
     or (tg_op = 'UPDATE' and exists (select 1 from cierres_mes c where c.empresa_id = old.empresa_id and c.mes = date_trunc('month', old.fecha)::date)) then
    raise exception 'El mes % ya está cerrado', to_char(r.fecha, 'YYYY-MM');
  end if;
  return coalesce(new, old);
end $$;
create trigger movimientos_mes_cerrado before insert or update or delete on movimientos
  for each row execute function bloquear_mes_cerrado();

-- ---------------------------------------------------------------------
-- Auditoría (quién cambió qué)
-- ---------------------------------------------------------------------
create table auditoria (
  id          bigserial primary key,
  tabla       text not null,
  registro_id uuid,
  accion      text not null,
  antes       jsonb,
  despues     jsonb,
  usuario     uuid default auth.uid(),
  fecha       timestamptz not null default now()
);

create function auditar() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into auditoria (tabla, registro_id, accion, antes, despues)
  values (tg_table_name,
          coalesce((to_jsonb(new)->>'id')::uuid, (to_jsonb(old)->>'id')::uuid),
          tg_op,
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text;
begin
  foreach t in array array['movimientos','ventas','venta_pagos','pedidos','pedido_items',
                           'facturas_proveedor','terceros','gastos_fijos','cuadres_caja'] loop
    execute format('create trigger %I_auditoria after insert or update or delete on %I
                    for each row execute function auditar()', t, t);
  end loop;
end $$;

-- =====================================================================
-- VISTAS (lo que hoy calculan las fórmulas de las hojas)
-- =====================================================================

-- Saldo de cada cuenta
create view v_saldos_cuenta with (security_invoker = true) as
select c.empresa_id, c.id as cuenta_id, c.nombre, c.tipo,
       coalesce(sum(case m.tipo when 'ingreso' then m.monto else -m.monto end), 0) as saldo
from cuentas c left join movimientos m on m.cuenta_id = c.id
group by c.id;

-- Saldo de cada bolsillo, separado en efectivo y banco (como LIBRO DIARIO)
create view v_saldos_bolsillo with (security_invoker = true) as
select b.empresa_id, b.id as bolsillo_id, b.codigo, b.nombre,
       case when c.tipo in ('efectivo','caja_menor') then 'efectivo' else 'banco' end as medio,
       sum(mb.monto) filter (where mb.monto > 0) as entradas,
       -sum(mb.monto) filter (where mb.monto < 0) as salidas,
       sum(mb.monto) as saldo
from bolsillos b
join movimiento_bolsillos mb on mb.bolsillo_id = b.id
join movimientos m on m.id = mb.movimiento_id
join cuentas c on c.id = m.cuenta_id
group by b.empresa_id, b.id, b.codigo, b.nombre, medio;

-- Resumen del mes (PANEL / CIERRE MES)
create view v_resumen_mes with (security_invoker = true) as
select m.empresa_id,
       date_trunc('month', m.fecha)::date as mes,
       sum(m.monto) filter (where m.tipo = 'ingreso' and m.clase = 'operacion') as ventas_caja,
       sum(m.monto) filter (where m.tipo = 'ingreso' and m.clase = 'operacion'
                              and c.tipo in ('efectivo','caja_menor')) as ventas_efectivo,
       sum(m.monto) filter (where m.tipo = 'ingreso' and m.clase = 'operacion'
                              and c.tipo in ('banco','billetera')) as ventas_banco,
       sum(m.monto) filter (where m.tipo = 'egreso' and m.clase = 'operacion') as egresos,
       coalesce(sum(m.monto) filter (where m.tipo = 'ingreso' and m.clase = 'operacion'), 0)
     - coalesce(sum(m.monto) filter (where m.tipo = 'egreso' and m.clase = 'operacion'), 0) as flujo_neto,
       count(distinct m.fecha) filter (where m.tipo = 'ingreso' and m.clase = 'operacion') as dias_con_ventas,
       count(*) filter (where m.tipo = 'egreso' and m.clase = 'operacion' and m.categoria_id is null) as gastos_sin_categoria
from movimientos m join cuentas c on c.id = m.cuenta_id
group by m.empresa_id, 2;

-- Gastos por categoría y tipo
create view v_gastos_categoria with (security_invoker = true) as
select m.empresa_id, date_trunc('month', m.fecha)::date as mes,
       cg.nombre as categoria, cg.tipo, sum(m.monto) as monto
from movimientos m left join categorias_gasto cg on cg.id = m.categoria_id
where m.tipo = 'egreso' and m.clase = 'operacion'
group by m.empresa_id, 2, cg.nombre, cg.tipo;

-- Ventas facturadas (venta por venta)
create view v_ventas_mes with (security_invoker = true) as
select empresa_id, date_trunc('month', fecha)::date as mes,
       count(*) as num_ventas, sum(total) as total_facturado
from ventas group by empresa_id, 2;

-- Cuentas por cobrar: ventas financiadas y créditos directos
create view v_cuentas_por_cobrar with (security_invoker = true) as
select v.empresa_id, vp.id as venta_pago_id, v.id as venta_id, v.fecha as fecha_venta,
       v.numero_factura, t.nombre as cliente, t.documento, e.nombre as vendedor,
       vp.forma, ef.nombre as entidad, vp.detalle, vp.monto,
       coalesce(sum(m.monto), 0) as recibido,
       vp.monto - coalesce(sum(m.monto), 0) as pendiente,
       vp.fecha_estimada_pago, max(m.fecha) as fecha_pago_real, vp.aplicado_en_factura,
       case
         when vp.monto - coalesce(sum(m.monto), 0) <= 0 and vp.aplicado_en_factura then 'Aplicado en factura'
         when vp.monto - coalesce(sum(m.monto), 0) <= 0 then 'Pagado: falta aplicar en factura'
         when vp.fecha_estimada_pago is null then 'Por confirmar'
         when vp.fecha_estimada_pago < current_date then 'Vencido'
         when vp.fecha_estimada_pago <= current_date + 1 then 'Por vencer'
         else 'En plazo'
       end as estado
from venta_pagos vp
join ventas v on v.id = vp.venta_id
left join terceros t on t.id = v.cliente_id
left join empleados e on e.id = v.vendedor_id
left join entidades_financiacion ef on ef.id = vp.entidad_id
left join movimientos m on m.venta_pago_id = vp.id and m.tipo = 'ingreso'
where vp.forma in ('financiada', 'credito_directo')
group by v.id, vp.id, t.nombre, t.documento, e.nombre, ef.nombre;

-- Estado de cuenta por proveedor (reemplaza PAGO PROVEEDORES)
create view v_estado_proveedores with (security_invoker = true) as
select t.empresa_id, t.id as proveedor_id, t.nombre, t.cupo_credito,
       coalesce(f.facturado, 0) as facturado,
       coalesce(p.pagado, 0) as pagado,
       coalesce(f.facturado, 0) - coalesce(p.pagado, 0) as saldo,
       t.cupo_credito - (coalesce(f.facturado, 0) - coalesce(p.pagado, 0)) as cupo_disponible
from terceros t
left join (select proveedor_id, sum(monto) facturado from facturas_proveedor group by 1) f on f.proveedor_id = t.id
left join (select tercero_id, sum(monto) pagado from movimientos
            where tipo = 'egreso' and clase = 'operacion' group by 1) p on p.tercero_id = t.id
where t.es_proveedor;

-- Pedidos bajo encargo con saldo, utilidad y alerta
create view v_pedidos with (security_invoker = true) as
with it as (
  select pedido_id,
         string_agg(descripcion, ' + ' order by descripcion) as producto,
         sum(cantidad * precio_venta)::numeric(14,2) as valor,
         bool_or(precio_venta is null) as falta_valor
  from pedido_items group by pedido_id
), ab as (
  select pedido_id,
         sum(monto) filter (where tipo = 'ingreso') as abonado,
         sum(monto) filter (where tipo = 'egreso')  as costo_pagado
  from movimientos where pedido_id is not null group by pedido_id
)
select p.empresa_id, p.id, p.numero, p.fecha_pedido, p.fecha_estimada, p.fecha_entrega_real,
       p.estado, it.producto, it.valor,
       coalesce(ab.abonado, 0) as abonado,
       it.valor - coalesce(ab.abonado, 0) as saldo,
       coalesce(ab.costo_pagado, 0) as costo_pagado,
       case when it.valor is not null then it.valor - coalesce(ab.costo_pagado, 0) end as utilidad,
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
left join terceros c  on c.id  = p.cliente_id
left join terceros pr on pr.id = p.proveedor_id;

-- Gastos fijos de un mes: previsto vs. pagado (reemplaza CRONOGRAMA DE PAGOS)
create function gastos_fijos_mes(p_empresa uuid, p_mes date)
returns table (gasto_fijo_id uuid, concepto text, fecha_limite date, previsto numeric,
               pagado numeric, diferencia numeric, estado text, dias_para_vencer int)
language sql stable security invoker as $$
  select g.id, g.concepto,
         case when g.dia_pago is not null then
           least(date_trunc('month', p_mes)::date + (g.dia_pago - 1),
                 (date_trunc('month', p_mes) + interval '1 month - 1 day')::date) end,
         g.monto_previsto,
         coalesce(sum(m.monto), 0),
         g.monto_previsto - coalesce(sum(m.monto), 0),
         case
           when coalesce(sum(m.monto), 0) >= g.monto_previsto then 'Pagado'
           when coalesce(sum(m.monto), 0) > 0 then 'Parcial'
           when g.dia_pago is not null and date_trunc('month', p_mes)::date + (g.dia_pago - 1) < current_date then 'Vencido'
           else 'Pendiente'
         end,
         case when g.dia_pago is not null then (date_trunc('month', p_mes)::date + (g.dia_pago - 1)) - current_date end
  from gastos_fijos g
  left join movimientos m on m.gasto_fijo_id = g.id and m.tipo = 'egreso'
        and date_trunc('month', m.fecha) = date_trunc('month', p_mes)
  where g.empresa_id = p_empresa and g.activo
  group by g.id
$$;

-- =====================================================================
-- SEGURIDAD: cada usuario solo ve las empresas a las que pertenece
-- =====================================================================
create function es_miembro(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where user_id = auth.uid() and empresa_id = p_empresa)
$$;

create function es_admin(p_empresa uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from miembros where user_id = auth.uid() and empresa_id = p_empresa and rol = 'admin')
$$;

alter table empresas enable row level security;
create policy empresas_ver on empresas for select to authenticated using (es_miembro(id));
create policy empresas_admin on empresas for update to authenticated using (es_admin(id));

alter table miembros enable row level security;
create policy miembros_ver on miembros for select to authenticated using (es_miembro(empresa_id));
create policy miembros_admin on miembros for all to authenticated using (es_admin(empresa_id)) with check (es_admin(empresa_id));

alter table festivos enable row level security;
create policy festivos_ver on festivos for select to authenticated using (true);

-- Tablas operativas: los miembros leen y escriben; solo el admin borra.
do $$ declare t text;
begin
  foreach t in array array['empleados','cuentas','bolsillos','categorias_gasto','metas_mes','terceros',
                           'entidades_financiacion','pedidos','ventas','facturas_proveedor','gastos_fijos',
                           'movimientos','cuadres_caja','cierres_mes','secuencias'] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy %I on %I for select to authenticated using (es_miembro(empresa_id))', t || '_ver', t);
    execute format('create policy %I on %I for insert to authenticated with check (es_miembro(empresa_id))', t || '_crear', t);
    execute format('create policy %I on %I for update to authenticated using (es_miembro(empresa_id)) with check (es_miembro(empresa_id))', t || '_editar', t);
    execute format('create policy %I on %I for delete to authenticated using (es_admin(empresa_id))', t || '_borrar', t);
  end loop;
end $$;

-- Tablas hijas: heredan el permiso de su padre.
alter table pedido_items enable row level security;
create policy pedido_items_todo on pedido_items for all to authenticated
  using (es_miembro((select empresa_id from pedidos where id = pedido_id)))
  with check (es_miembro((select empresa_id from pedidos where id = pedido_id)));

alter table venta_pagos enable row level security;
create policy venta_pagos_todo on venta_pagos for all to authenticated
  using (es_miembro((select empresa_id from ventas where id = venta_id)))
  with check (es_miembro((select empresa_id from ventas where id = venta_id)));

alter table movimiento_bolsillos enable row level security;
create policy movimiento_bolsillos_ver on movimiento_bolsillos for select to authenticated
  using (es_miembro((select empresa_id from movimientos where id = movimiento_id)));

alter table auditoria enable row level security;
create policy auditoria_admin on auditoria for select to authenticated
  using (exists (select 1 from miembros where user_id = auth.uid() and rol = 'admin'));

-- Los triggers escriben en tablas protegidas en nombre del usuario
alter function repartir_bolsillos() security definer set search_path = public;
alter function venta_pago_a_libro() security definer set search_path = public;
alter function siguiente_numero(uuid, text) security definer set search_path = public;
