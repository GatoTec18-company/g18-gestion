import Link from 'next/link';
import { sql, uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, nombreMes } from '@/lib/formato';
import { Encabezado, SelectorMes } from '@/components/ui/Comunes';

const TIPO_GASTO = {
  proveedores: 'Proveedores', inversion: 'Inversión', gasto_fijo: 'Gasto fijo', gasto_variable: 'Gasto variable',
  nomina: 'Nómina', deuda_financieros: 'Deuda y financieros', impuestos_bancarios: 'Impuestos y bancarios', otros: 'Otros',
};

export default async function Panel({ searchParams }) {
  const { empresa, mes, mesInicio } = await requerir(searchParams, 'panel');
  const e = empresa.id;
  const [r, meta, saldo, bols, gastos, dias, ped, cxc, gf] = await Promise.all([
    uno('select * from v_resumen_mes where empresa_id = $1 and mes = $2', [e, mesInicio]),
    uno('select meta_ventas from metas_mes where empresa_id = $1 and mes = $2', [e, mesInicio]),
    uno(`select coalesce(sum(case tipo when 'ingreso' then monto else -monto end), 0) saldo from movimientos
         where empresa_id = $1 and fecha < ($2::date + interval '1 month')`, [e, mesInicio]),
    sql(`select b.codigo, b.nombre, b.porcentaje,
           coalesce(sum(x.monto) filter (where x.medio in ('efectivo','caja_menor')), 0) efectivo,
           coalesce(sum(x.monto) filter (where x.medio in ('banco','billetera')), 0) banco,
           coalesce(sum(x.monto) filter (where x.tipo = 'ingreso' and x.clase = 'operacion' and x.fecha >= $2), 0) le_toco,
           coalesce(-sum(x.monto) filter (where x.tipo = 'egreso' and x.clase = 'operacion' and x.fecha >= $2), 0) gasto
         from bolsillos b
         left join (select mb.bolsillo_id, mb.monto, m.tipo, m.clase, m.fecha, c.tipo::text medio
                    from movimiento_bolsillos mb join movimientos m on m.id = mb.movimiento_id
                    join cuentas c on c.id = m.cuenta_id
                    where m.fecha < ($2::date + interval '1 month')) x on x.bolsillo_id = b.id
         where b.empresa_id = $1
         group by b.id order by b.orden`, [e, mesInicio]),
    sql(`select categoria, tipo, monto from v_gastos_categoria where empresa_id = $1 and mes = $2 order by monto desc`, [e, mesInicio]),
    sql(`select extract(day from d)::int dia, coalesce(sum(m.monto), 0) total
         from generate_series($2::date, ($2::date + interval '1 month - 1 day'), interval '1 day') d
         left join movimientos m on m.fecha = d::date and m.empresa_id = $1 and m.tipo = 'ingreso' and m.clase = 'operacion'
         group by d order by d`, [e, mesInicio]),
    uno(`select count(*) filter (where alerta = 'ATRASADO') atrasados, count(*) filter (where alerta = 'FALTA VALOR') sin_valor,
           count(*) filter (where alerta = 'POR PEDIR') por_pedir, coalesce(sum(saldo) filter (where estado <> 'cancelado'), 0) saldo
         from v_pedidos where empresa_id = $1`, [e]),
    uno(`select coalesce(sum(pendiente), 0) pendiente, count(*) filter (where estado = 'Vencido') vencidas,
           count(*) filter (where estado = 'Por vencer') por_vencer,
           count(*) filter (where estado = 'Pagado: falta aplicar en factura') sin_aplicar
         from v_cuentas_por_cobrar where empresa_id = $1 and etapa <> 'rechazada'`, [e]),
    uno(`select count(*) filter (where estado = 'Vencido') vencidos, coalesce(sum(greatest(diferencia, 0)), 0) por_pagar
         from gastos_fijos_mes($1, $2)`, [e, mesInicio]),
  ]);

  const porRevisar = (await sql(`select count(*) n from ventas where empresa_id = $1 and revision = 'pendiente'`, [e]))[0].n;
  const ventas = r?.ventas_caja ?? 0, egresos = r?.egresos ?? 0;
  const pctMeta = meta ? ventas / meta.meta_ventas : null;
  const totalGastos = gastos.reduce((s, g) => s + g.monto, 0);
  const maxDia = Math.max(1, ...dias.map(d => d.total));
  const diasCon = dias.filter(d => d.total > 0).length;
  const porTipo = Object.entries(gastos.reduce((a, g) => ({ ...a, [g.tipo ?? 'sin']: (a[g.tipo ?? 'sin'] ?? 0) + g.monto }), {}))
    .sort((a, b) => b[1] - a[1]);
  const pasados = bols.filter(b => b.gasto > b.le_toco).length;

  return (
    <>
      <Encabezado titulo="Panel financiero" sub={`${empresa.nombre} · ${nombreMes(mes)}`}>
        <SelectorMes mes={mes} ruta="/" />
      </Encabezado>

      <section className="kpis">
        <div className="kpi"><div className="et">Ventas del mes</div><div className="va">{cop(ventas)}</div>
          <div className="de">Efectivo {cop(r?.ventas_efectivo ?? 0)} · Banco {cop(r?.ventas_banco ?? 0)}</div></div>
        <div className="kpi"><div className="et">Egresos</div><div className="va">{cop(egresos)}</div>
          <div className="de">{r?.gastos_sin_categoria ? `${r.gastos_sin_categoria} sin categoría` : 'Todos con categoría'}</div></div>
        <div className="kpi"><div className="et">Flujo neto</div><div className={`va ${ventas - egresos < 0 ? 'neg' : 'pos'}`}>{cop(ventas - egresos)}</div>
          <div className="de">Ventas − egresos</div></div>
        <div className="kpi"><div className="et">Saldo real (caja + bancos)</div><div className={`va ${saldo.saldo < 0 ? 'neg' : ''}`}>{cop(saldo.saldo)}</div>
          <div className="de">Al cierre del mes</div></div>
        <div className="kpi"><div className="et">Meta de ventas</div>
          <div className="va">{pctMeta === null ? '—' : `${Math.round(pctMeta * 100)} %`}</div>
          <div className="de">{meta ? `de ${cop(meta.meta_ventas)}` : 'Sin meta para este mes'}</div>
          {pctMeta !== null && <div className="barra"><div style={{ width: `${Math.min(100, pctMeta * 100)}%` }} /></div>}</div>
      </section>

      <div className="grilla">
        <section className="caja">
          <h2>Alertas</h2>
          <ul className="alertas">
            {porRevisar > 0 && <li>🔎 <span><b>{porRevisar}</b> ventas por confirmar en la plataforma · <Link href="/cartera?etapa=por_confirmar">revisar</Link></span></li>}
            <li>⚠️ <span><b>{pasados} de {bols.length}</b> bolsillos gastaron este mes más de lo que les tocó por ventas</span></li>
            <li>📦 <span><b>{ped.atrasados}</b> pedidos atrasados · <b>{ped.sin_valor}</b> sin valor · <b>{ped.por_pedir}</b> por pedir · saldo por cobrar <b>{cop(ped.saldo)}</b></span></li>
            <li>💳 <span>Por cobrar a entidades <b>{cop(cxc.pendiente)}</b> · <b>{cxc.vencidas}</b> vencidas · <b>{cxc.por_vencer}</b> por vencer · <b>{cxc.sin_aplicar}</b> pagadas sin aplicar en factura</span></li>
            <li>⏰ <span><b>{gf.vencidos}</b> gastos fijos vencidos · faltan <b>{cop(gf.por_pagar)}</b> por pagar del mes</span></li>
            <li>📅 <span><b>{diasCon}</b> días con ventas · promedio por día con ventas <b>{cop(diasCon ? ventas / diasCon : 0)}</b></span></li>
          </ul>
        </section>

        <section className="caja">
          <h2>Ventas por día</h2>
          <div className="barras">
            {dias.map(d => (
              <div className="col" key={d.dia} title={`${d.dia}: ${cop(d.total)}`}>
                <div className={`b ${d.total ? '' : 'cero'}`} style={{ height: `${(d.total / maxDia) * 100}%` }} />
                <span className="d">{d.dia % 5 === 1 || d.dia === dias.length ? d.dia : ''}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="caja">
        <h2>Bolsillos <small>saldo acumulado al cierre del mes</small></h2>
        <div className="tabla-cont"><table>
          <thead><tr><th>Bolsillo</th><th className="n">%</th><th className="n">Efectivo</th><th className="n">Banco</th><th className="n">Total</th>
            <th className="n">Le tocó este mes</th><th className="n">Gastó este mes</th></tr></thead>
          <tbody>{bols.map(b => (
            <tr key={b.codigo}>
              <td><b>{b.codigo}</b> · {b.nombre}</td><td className="n">{b.porcentaje}</td>
              <td className={`n ${b.efectivo < 0 ? 'neg' : ''}`}>{cop(b.efectivo)}</td>
              <td className={`n ${b.banco < 0 ? 'neg' : ''}`}>{cop(b.banco)}</td>
              <td className={`n ${b.efectivo + b.banco < 0 ? 'neg' : ''}`}><b>{cop(b.efectivo + b.banco)}</b></td>
              <td className="n">{cop(b.le_toco)}</td>
              <td className={`n ${b.gasto > b.le_toco ? 'neg' : ''}`}>{cop(b.gasto)}</td>
            </tr>))}
          </tbody>
          <tfoot><tr><td>Total</td><td /><td className="n">{cop(bols.reduce((s, b) => s + b.efectivo, 0))}</td>
            <td className="n">{cop(bols.reduce((s, b) => s + b.banco, 0))}</td>
            <td className="n">{cop(bols.reduce((s, b) => s + b.efectivo + b.banco, 0))}</td>
            <td className="n">{cop(bols.reduce((s, b) => s + b.le_toco, 0))}</td><td className="n">{cop(bols.reduce((s, b) => s + b.gasto, 0))}</td></tr></tfoot>
        </table></div>
      </section>

      <div className="grilla">
        <section className="caja">
          <h2>Gastos por categoría</h2>
          <div className="tabla-cont"><table>
            <thead><tr><th>Categoría</th><th className="n">Monto</th><th className="n">% del gasto</th></tr></thead>
            <tbody>{gastos.map(g => (
              <tr key={g.categoria ?? 'sin'}><td>{g.categoria ?? 'Sin categoría'}</td><td className="n">{cop(g.monto)}</td>
                <td className="n">{totalGastos ? Math.round((g.monto / totalGastos) * 100) : 0} %</td></tr>))}
            </tbody>
          </table></div>
        </section>
        <section className="caja">
          <h2>Gastos por tipo</h2>
          <div className="tabla-cont"><table>
            <thead><tr><th>Tipo</th><th className="n">Monto</th><th className="n">% de las ventas</th></tr></thead>
            <tbody>{porTipo.map(([t, m]) => (
              <tr key={t}><td>{TIPO_GASTO[t] ?? 'Sin categoría'}</td><td className="n">{cop(m)}</td>
                <td className="n">{ventas ? Math.round((m / ventas) * 100) : 0} %</td></tr>))}
            </tbody>
          </table></div>
        </section>
      </div>
    </>
  );
}
