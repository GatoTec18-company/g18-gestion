import 'server-only';
import { sql, uno } from './db';

const TIPO_GASTO = {
  proveedores: 'Proveedores', inversion: 'Inversión', gasto_fijo: 'Gasto fijo', gasto_variable: 'Gasto variable',
  nomina: 'Nómina', deuda_financieros: 'Deuda y financieros', impuestos_bancarios: 'Impuestos y bancarios', otros: 'Otros',
};
const DESTINO = { mercancia: 'Mercancía para vender', pedido_cliente: 'Pedidos de clientes', activos: 'Equipos / activos', saldo_inicial: 'Saldo que se debía', otro: 'Otro' };

// Todo lo que se necesita para el corte del mes de una empresa (lo usan la pantalla y el cierre).
export async function resumenMes(e, mesInicio) {
  const finMes = `(date '${mesInicio}' + interval '1 month')`;
  const [r, saldos, bolsillos, porTipo, porCategoria, gf, cxc, prov, bancos, compras, sinCat, sinProv, meta] = await Promise.all([
    uno(`select * from v_resumen_mes where empresa_id = $1 and mes = $2`, [e, mesInicio]),
    sql(`select c.id, c.nombre, c.tipo, coalesce(sum(case m.tipo when 'ingreso' then m.monto else -m.monto end), 0) saldo
         from cuentas c left join movimientos m on m.cuenta_id = c.id and m.fecha < ${finMes}
         where c.empresa_id = $1 group by c.id order by c.tipo, c.nombre`, [e]),
    sql(`select b.codigo, b.nombre, case when c.tipo in ('efectivo','caja_menor') then 'efectivo' else 'cuentas' end medio, sum(mb.monto) saldo
         from bolsillos b join movimiento_bolsillos mb on mb.bolsillo_id = b.id join movimientos m on m.id = mb.movimiento_id and m.fecha < ${finMes}
         join cuentas c on c.id = m.cuenta_id where b.empresa_id = $1 group by b.id, medio order by medio, b.orden`, [e]),
    sql(`select cg.tipo, sum(m.monto) monto from movimientos m left join categorias_gasto cg on cg.id = m.categoria_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and m.clase = 'operacion' and date_trunc('month', m.fecha) = $2::date
         group by cg.tipo order by 2 desc`, [e, mesInicio]),
    sql(`select cg.nombre categoria, sum(m.monto) monto from movimientos m left join categorias_gasto cg on cg.id = m.categoria_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and m.clase = 'operacion' and date_trunc('month', m.fecha) = $2::date
         group by cg.nombre order by 2 desc`, [e, mesInicio]),
    sql(`select * from gastos_fijos_mes($1, $2) where estado <> 'Pagado' order by fecha_limite nulls last`, [e, mesInicio]),
    uno(`select coalesce(sum(pendiente) filter (where etapa in ('por_confirmar','esperando_pago')), 0) pendiente,
           count(*) filter (where etapa = 'por_facturar') sin_factura from v_cuentas_por_cobrar where empresa_id = $1`, [e]),
    uno(`select coalesce(sum(greatest(saldo, 0)), 0) deuda from v_estado_proveedores where empresa_id = $1`, [e]),
    uno(`select coalesce(sum(greatest(saldo, 0)), 0) deuda, count(*) filter (where activo) n from v_creditos where empresa_id = $1`, [e]),
    // Compras a crédito del mes (proveedores y tarjetas) según para qué fueron
    sql(`select destino, sum(monto) monto from (
           select destino, monto, fecha from facturas_proveedor where empresa_id = $1 and destino <> 'saldo_inicial'
           union all
           select g.destino, g.monto, g.fecha from credito_cargos g join creditos c on c.id = g.credito_id where c.empresa_id = $1
         ) x where date_trunc('month', fecha) = $2::date group by destino order by 2 desc`, [e, mesInicio]),
    uno(`select count(*)::int n from movimientos where empresa_id = $1 and tipo = 'egreso' and clase = 'operacion'
         and categoria_id is null and date_trunc('month', fecha) = $2::date`, [e, mesInicio]),
    uno(`select count(*)::int n from movimientos m join categorias_gasto cg on cg.id = m.categoria_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and m.tercero_id is null and cg.tipo = 'proveedores'
         and date_trunc('month', m.fecha) = $2::date`, [e, mesInicio]),
    uno(`select meta_ventas from metas_mes where empresa_id = $1 and mes = $2`, [e, mesInicio]),
  ]);
  const efectivo = saldos.filter(c => ['efectivo', 'caja_menor'].includes(c.tipo)).reduce((s, c) => s + c.saldo, 0);
  const banco = saldos.filter(c => !['efectivo', 'caja_menor'].includes(c.tipo)).reduce((s, c) => s + c.saldo, 0);
  const egresos = r?.egresos ?? 0;
  const compras75 = bolsillos.length ? await uno(`select coalesce(-sum(mb.monto), 0) v from movimiento_bolsillos mb
      join movimientos m on m.id = mb.movimiento_id join bolsillos b on b.id = mb.bolsillo_id
      where m.empresa_id = $1 and m.tipo = 'egreso' and m.clase = 'operacion' and b.codigo = '75' and date_trunc('month', m.fecha) = $2::date`, [e, mesInicio]) : { v: 0 };
  return {
    ventas: r?.ventas_caja ?? 0, ventasEfectivo: r?.ventas_efectivo ?? 0, ventasBanco: r?.ventas_banco ?? 0,
    egresos, flujo: (r?.ventas_caja ?? 0) - egresos, meta: meta?.meta_ventas ?? null,
    saldoEfectivo: efectivo, saldoBanco: banco, saldoReal: efectivo + banco, cuentas: saldos, bolsillos,
    porTipo: porTipo.map(x => ({ tipo: TIPO_GASTO[x.tipo] ?? 'Sin categoría', monto: x.monto })),
    porCategoria: porCategoria.map(x => ({ categoria: x.categoria ?? 'Sin categoría', monto: x.monto })),
    compras75: compras75.v, gastosOperativos: egresos - compras75.v,
    comprasCredito: compras.map(x => ({ destino: DESTINO[x.destino] ?? x.destino, monto: x.monto })),
    gastosFijosPendientes: gf, carteraPendiente: cxc.pendiente, ventasSinFactura: cxc.sin_factura,
    deudaProveedores: prov.deuda, deudaBancos: bancos.deuda, creditosActivos: bancos.n,
    egresosSinCategoria: sinCat.n, pagosSinProveedor: sinProv.n,
  };
}
