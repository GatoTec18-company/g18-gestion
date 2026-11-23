import Link from 'next/link';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Encabezado, SelectorMes, Vacio } from '@/components/ui/Comunes';
import FormMovimiento from '@/components/formularios/FormMovimiento';
import FormVentasDia from '@/components/formularios/FormVentasDia';

const FILTROS = [['', 'Todos'], ['ingreso', 'Ingresos'], ['egreso', 'Egresos']];
const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

export default async function Libro({ searchParams }) {
  const { empresa, mes, mesInicio, sp } = await requerir(searchParams, 'libro');
  const e = empresa.id;
  const tipo = ['ingreso', 'egreso'].includes(sp.tipo) ? sp.tipo : '';
  const [movs, cuentas, bolsillos, categorias, proveedores, gastosFijos, ventasDia] = await Promise.all([
    sql(`select m.id, m.fecha, m.tipo, m.clase, m.monto, m.concepto, c.nombre cuenta, b.codigo bolsillo,
            cg.nombre categoria, t.nombre tercero, g.concepto gasto_fijo, p.numero pedido
         from movimientos m join cuentas c on c.id = m.cuenta_id
         left join bolsillos b on b.id = m.bolsillo_id left join categorias_gasto cg on cg.id = m.categoria_id
         left join terceros t on t.id = m.tercero_id left join gastos_fijos g on g.id = m.gasto_fijo_id
         left join pedidos p on p.id = m.pedido_id
         where m.empresa_id = $1 and date_trunc('month', m.fecha) = $2::date and ($3 = '' or m.tipo::text = $3)
         order by m.fecha desc, m.creado_en desc`, [e, mesInicio, tipo]),
    sql(`select id, nombre, tipo from cuentas where empresa_id = $1 and activa order by (nombre = 'Bancos') desc, tipo, nombre`, [e]),
    sql('select id, codigo, nombre from bolsillos where empresa_id = $1 order by orden', [e]),
    sql('select id, nombre from categorias_gasto where empresa_id = $1 and activa order by nombre', [e]),
    sql('select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre', [e]),
    sql('select id, concepto from gastos_fijos where empresa_id = $1 and activo order by concepto', [e]),
    sql(`select m.fecha, m.cuenta_id, c.tipo, sum(m.monto) monto from movimientos m join cuentas c on c.id = m.cuenta_id
         where m.empresa_id = $1 and date_trunc('month', m.fecha) = $2::date and m.tipo = 'ingreso' and m.clase = 'operacion'
           and m.concepto like 'Ventas del día%' group by 1, 2, 3`, [e, mesInicio]),
  ]);
  const ing = movs.filter(m => m.tipo === 'ingreso' && m.clase === 'operacion').reduce((s, m) => s + m.monto, 0);
  const egr = movs.filter(m => m.tipo === 'egreso' && m.clase === 'operacion').reduce((s, m) => s + m.monto, 0);

  // Ventas del día: mapa para el formulario y tabla día por día del mes
  const porDia = {};
  for (const v of ventasDia) (porDia[v.fecha] ??= {})[v.cuenta_id] = v.monto;
  const [a, m] = mes.split('-').map(Number);
  const diasMes = new Date(a, m, 0).getDate();
  const hoy = hoyCol();
  const filas = Array.from({ length: diasMes }, (_, i) => {
    const f = `${mes}-${String(i + 1).padStart(2, '0')}`;
    const del = ventasDia.filter(v => v.fecha === f);
    const ef = del.filter(v => ['efectivo', 'caja_menor'].includes(v.tipo)).reduce((s, v) => s + v.monto, 0);
    const bc = del.filter(v => !['efectivo', 'caja_menor'].includes(v.tipo)).reduce((s, v) => s + v.monto, 0);
    return { f, dia: i + 1, sem: DIAS[new Date(a, m - 1, i + 1).getDay()], ef, bc, futuro: f > hoy };
  });
  const tEf = filas.reduce((s, x) => s + x.ef, 0), tBc = filas.reduce((s, x) => s + x.bc, 0);
  const diaElegido = /^\d{4}-\d{2}-\d{2}$/.test(sp.dia ?? '') ? sp.dia : (hoy.startsWith(mes) ? hoy : `${mes}-01`);

  return (
    <>
      <Encabezado titulo="Libro diario" sub={`${empresa.nombre} · ${nombreMes(mes)}`}>
        <SelectorMes mes={mes} ruta="/libro" />
      </Encabezado>

      <div className="dos">
        <section className="caja">
          <h2>Ventas del día</h2>
          <FormVentasDia key={diaElegido} hoy={diaElegido} cuentaEfectivo={cuentas.find(c => c.tipo === 'efectivo')}
            cuentasBanco={cuentas.filter(c => ['banco', 'billetera'].includes(c.tipo))} porDia={porDia} />
        </section>
        <section className="caja">
          <h2>Ventas por día <small>toca un día para editarlo</small></h2>
          <div className="tabla-cont tabla-dias"><table>
            <thead><tr><th>Día</th><th className="n">Efectivo</th><th className="n">Cuentas</th><th className="n">Total</th></tr></thead>
            <tbody>{filas.filter(x => !x.futuro || x.ef || x.bc).map(x => (
              <tr key={x.f} className={x.f === diaElegido ? 'fila-activa' : ''}>
                <td className="nw"><Link href={`/libro?mes=${mes}&dia=${x.f}`}>{x.sem} {x.dia}</Link></td>
                <td className="n">{x.ef ? cop(x.ef) : <span className="muted">—</span>}</td>
                <td className="n">{x.bc ? cop(x.bc) : <span className="muted">—</span>}</td>
                <td className="n"><b>{x.ef + x.bc ? cop(x.ef + x.bc) : ''}</b></td>
              </tr>))}
            </tbody>
            <tfoot><tr><td>Total</td><td className="n">{cop(tEf)}</td><td className="n">{cop(tBc)}</td><td className="n">{cop(tEf + tBc)}</td></tr></tfoot>
          </table></div>
        </section>
      </div>

      <section className="caja">
        <h2>Registrar egreso <small>o un ingreso distinto a las ventas del día</small></h2>
        <FormMovimiento hoy={hoy} cuentas={cuentas} bolsillos={bolsillos} categorias={categorias}
          proveedores={proveedores} gastosFijos={gastosFijos} />
      </section>

      <section className="caja">
        <h2>Movimientos <small>{movs.length} · ingresos {cop(ing)} · egresos {cop(egr)}</small></h2>
        <div className="filtros">
          {FILTROS.map(([v, t]) => (
            <Link key={v} href={`/libro?mes=${mes}${v ? `&tipo=${v}` : ''}`} className={tipo === v ? 'activo' : ''}>{t}</Link>
          ))}
        </div>
        {movs.length === 0 ? <Vacio>No hay movimientos en este mes.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Cuenta</th><th>Bolsillo</th><th>Categoría</th><th>Vinculado a</th><th className="n">Ingreso</th><th className="n">Egreso</th></tr></thead>
            <tbody>{movs.map(mv => (
              <tr key={mv.id}>
                <td>{fecha(mv.fecha)}</td>
                <td>{mv.concepto}{mv.clase !== 'operacion' && <div className="muted">{mv.clase.replace('_', ' ')}</div>}</td>
                <td>{mv.cuenta}</td>
                <td>{mv.bolsillo ?? (mv.tipo === 'ingreso' ? <span className="muted">repartido</span> : '—')}</td>
                <td>{mv.categoria ?? '—'}</td>
                <td className="muted">{[mv.tercero, mv.gasto_fijo, mv.pedido].filter(Boolean).join(' · ') || '—'}</td>
                <td className="n pos">{mv.tipo === 'ingreso' ? cop(mv.monto) : ''}</td>
                <td className="n">{mv.tipo === 'egreso' ? cop(mv.monto) : ''}</td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
