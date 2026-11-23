-- =====================================================================
-- Seguimiento de cada venta financiada por etapas:
--   1. por_confirmar   → registrada; falta verla reflejada en la plataforma (Addi, Sumas Pay…)
--   2. esperando_pago  → confirmada en la plataforma; falta que la plata llegue a la cuenta
--   3. por_facturar    → la plata llegó; falta aplicarla a la factura en el sistema contable
--   4. cerrada         → aplicada en la factura
--   (rechazada         → no corresponde / anulada)
-- =====================================================================

alter table venta_pagos
  add column aplicado_en  timestamptz,
  add column aplicado_por uuid references auth.users(id);

-- Las ventas importadas que ya estaban aplicadas quedan con fecha de hoy como referencia
update venta_pagos set aplicado_en = now() where aplicado_en_factura and aplicado_en is null;

drop view v_cuentas_por_cobrar;
create view v_cuentas_por_cobrar with (security_invoker = true) as
with rec as (
  select venta_pago_id, sum(monto) recibido, max(fecha) ultima, (array_agg(cuenta_id order by fecha desc))[1] cuenta_id
  from cobros group by 1
), base as (
  select v.empresa_id, vp.id as venta_pago_id, v.id as venta_id, v.fecha as fecha_venta,
         v.numero_factura, t.nombre as cliente, t.documento, t.telefono, e.nombre as vendedor,
         vp.forma, ef.nombre as entidad, vp.detalle, vp.referencia, v.producto, vp.monto,
         vp.recibido_previo + coalesce(rec.recibido, 0) as recibido,
         vp.monto - vp.recibido_previo - coalesce(rec.recibido, 0) as pendiente,
         vp.fecha_estimada_pago,
         coalesce(rec.ultima, vp.fecha_recibido_previo) as fecha_pago_real,
         cu.nombre as cuenta_pago,
         vp.aplicado_en_factura, vp.aplicado_en,
         v.revision, v.revisado_en, v.nota_revision, v.registrado_por, v.creado_en
  from venta_pagos vp
  join ventas v on v.id = vp.venta_id
  left join rec on rec.venta_pago_id = vp.id
  left join cuentas cu on cu.id = rec.cuenta_id
  left join terceros t on t.id = v.cliente_id
  left join empleados e on e.id = v.vendedor_id
  left join entidades_financiacion ef on ef.id = vp.entidad_id
  where vp.forma in ('financiada', 'credito_directo')
)
select base.*,
  case
    when revision = 'rechazada' then 'rechazada'
    when revision = 'pendiente' then 'por_confirmar'
    when pendiente > 0 then 'esperando_pago'
    when not aplicado_en_factura then 'por_facturar'
    else 'cerrada'
  end as etapa,
  case
    when revision = 'rechazada' then 'Rechazada'
    when revision = 'pendiente' then 'Por confirmar'
    when pendiente <= 0 and aplicado_en_factura then 'Aplicado en factura'
    when pendiente <= 0 then 'Pagado: falta aplicar en factura'
    when fecha_estimada_pago is null then 'Por confirmar'
    when fecha_estimada_pago < current_date then 'Vencido'
    when fecha_estimada_pago <= current_date + 1 then 'Por vencer'
    else 'En plazo'
  end as estado
from base;
