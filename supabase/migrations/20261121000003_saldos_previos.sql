-- =====================================================================
-- Saldos de antes del sistema
-- Los abonos de pedidos y los pagos de entidades que ya estaban en las
-- hojas ya entraron a la caja (están en las ventas del día del libro).
-- Se guardan como "previos" para que el saldo del pedido o de la venta
-- sea correcto SIN volver a sumar esa plata a la caja.
-- =====================================================================

alter table pedidos
  add column abonado_previo numeric(14,2) not null default 0 check (abonado_previo >= 0);

alter table venta_pagos
  add column recibido_previo numeric(14,2) not null default 0 check (recibido_previo >= 0),
  add column fecha_recibido_previo date;

-- La fecha de entrega real solo se pone sola cuando el pedido CAMBIA a entregado
-- (al importar pedidos viejos no se inventa una fecha).
create or replace function pedidos_numerar() returns trigger language plpgsql as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := 'PED-' || lpad(siguiente_numero(new.empresa_id, 'pedido')::text, 3, '0');
  end if;
  if tg_op = 'UPDATE' and new.estado = 'entregado' and old.estado <> 'entregado'
     and new.fecha_entrega_real is null then
    new.fecha_entrega_real := current_date;
  end if;
  return new;
end $$;

drop view v_cuentas_por_cobrar;
create view v_cuentas_por_cobrar with (security_invoker = true) as
select v.empresa_id, vp.id as venta_pago_id, v.id as venta_id, v.fecha as fecha_venta,
       v.numero_factura, t.nombre as cliente, t.documento, e.nombre as vendedor,
       vp.forma, ef.nombre as entidad, vp.detalle, vp.monto,
       vp.recibido_previo + coalesce(sum(m.monto), 0) as recibido,
       vp.monto - vp.recibido_previo - coalesce(sum(m.monto), 0) as pendiente,
       vp.fecha_estimada_pago,
       coalesce(max(m.fecha), vp.fecha_recibido_previo) as fecha_pago_real,
       vp.aplicado_en_factura,
       case
         when vp.monto - vp.recibido_previo - coalesce(sum(m.monto), 0) <= 0 and vp.aplicado_en_factura then 'Aplicado en factura'
         when vp.monto - vp.recibido_previo - coalesce(sum(m.monto), 0) <= 0 then 'Pagado: falta aplicar en factura'
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

drop view v_pedidos;
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
       p.abonado_previo + coalesce(ab.abonado, 0) as abonado,
       it.valor - p.abonado_previo - coalesce(ab.abonado, 0) as saldo,
       coalesce(ab.costo_pagado, 0) as costo_pagado,
       case when it.valor is not null and ab.costo_pagado is not null then it.valor - ab.costo_pagado end as utilidad,
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
