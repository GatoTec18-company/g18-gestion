-- =====================================================================
-- Gastos fijos compartidos: arriendo, luz, agua, nómina… son del negocio,
-- y se pagan desde la empresa que tenga la plata en ese momento.
-- =====================================================================
alter table gastos_fijos add column compartido boolean not null default true;

-- Previsto contra pagado: incluye los gastos compartidos y cuenta los pagos hechos desde cualquiera de las dos empresas
create or replace function gastos_fijos_mes(p_empresa uuid, p_mes date)
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
  where g.activo and (g.empresa_id = p_empresa or g.compartido)
  group by g.id
$$;
