import 'server-only';
import { sql } from './db';

// Grupos de "¿A dónde se fue la plata?" (en el orden en que se muestran)
export const GRUPOS = [
  'Mercancía nueva', 'Pedidos de clientes', 'Pagos a proveedores', 'Bancos y créditos',
  'Nómina', 'Gastos fijos', 'Impuestos y bancarios', 'Equipos e inversión', 'Variables y otros', 'Sin categoría',
];

const GRUPO_SQL = `case
    when m.credito_id is not null then 'Bancos y créditos'
    when cg.id is null then 'Sin categoría'
    when cg.nombre ilike 'mercanc%' then 'Mercancía nueva'
    when cg.nombre ilike 'pedidos de clientes%' then 'Pedidos de clientes'
    when cg.tipo = 'proveedores' then 'Pagos a proveedores'
    when cg.tipo = 'deuda_financieros' then 'Bancos y créditos'
    when cg.tipo = 'nomina' then 'Nómina'
    when cg.tipo = 'gasto_fijo' then 'Gastos fijos'
    when cg.tipo = 'impuestos_bancarios' then 'Impuestos y bancarios'
    when cg.tipo = 'inversion' then 'Equipos e inversión'
    else 'Variables y otros' end`;

// Meses entre desde y hasta (AAAA-MM), ambos incluidos
export function meses(desde, hasta) {
  const out = [];
  let [a, m] = desde.split('-').map(Number);
  const [ah, mh] = hasta.split('-').map(Number);
  while (a < ah || (a === ah && m <= mh)) {
    out.push(`${a}-${String(m).padStart(2, '0')}`);
    if (++m > 12) { m = 1; a++; }
  }
  return out;
}

// Ventas (caja) y egresos por grupo, mes a mes, de una empresa
export async function flujoPorMes(empresa, desde, hasta) {
  const ini = `${desde}-01`, fin = `${hasta}-01`;
  const [ventas, egresos, compras] = await Promise.all([
    sql(`select to_char(fecha, 'YYYY-MM') mes,
           sum(monto) filter (where c.tipo in ('efectivo','caja_menor')) efectivo,
           sum(monto) filter (where c.tipo not in ('efectivo','caja_menor')) banco, sum(monto) total
         from movimientos m join cuentas c on c.id = m.cuenta_id
         where m.empresa_id = $1 and m.tipo = 'ingreso' and m.clase = 'operacion'
           and m.fecha >= $2 and m.fecha < ($3::date + interval '1 month') group by 1`, [empresa, ini, fin]),
    sql(`select to_char(m.fecha, 'YYYY-MM') mes, ${GRUPO_SQL} grupo, sum(m.monto) monto
         from movimientos m left join categorias_gasto cg on cg.id = m.categoria_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and m.clase = 'operacion'
           and m.fecha >= $2 and m.fecha < ($3::date + interval '1 month') group by 1, 2`, [empresa, ini, fin]),
    // Compras a crédito (todavía no pagadas en caja): facturas de proveedor y cargos a tarjetas/créditos
    sql(`select to_char(fecha, 'YYYY-MM') mes, destino, sum(monto) monto from (
           select fecha, destino, monto from facturas_proveedor where empresa_id = $1 and destino <> 'saldo_inicial'
           union all
           select g.fecha, g.destino, g.monto from credito_cargos g join creditos cr on cr.id = g.credito_id where cr.empresa_id = $1
         ) x where fecha >= $2 and fecha < ($3::date + interval '1 month') group by 1, 2`, [empresa, ini, fin]),
  ]);
  return meses(desde, hasta).map(mes => {
    const v = ventas.find(x => x.mes === mes);
    const porGrupo = Object.fromEntries(GRUPOS.map(g => [g, egresos.find(x => x.mes === mes && x.grupo === g)?.monto ?? 0]));
    const totalEgresos = Object.values(porGrupo).reduce((s, x) => s + x, 0);
    const credito = Object.fromEntries(compras.filter(x => x.mes === mes).map(x => [x.destino, x.monto]));
    return { mes, ventas: v?.total ?? 0, ventasEfectivo: v?.efectivo ?? 0, ventasBanco: v?.banco ?? 0,
      porGrupo, egresos: totalEgresos, flujo: (v?.total ?? 0) - totalEgresos, comprasCredito: credito };
  });
}
