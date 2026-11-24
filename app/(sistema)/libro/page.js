import Link from 'next/link';
import Acciones from '@/components/ui/Acciones';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Encabezado, SelectorMes, Vacio } from '@/components/ui/Comunes';
import FormMovimiento from '@/components/formularios/FormMovimiento';
import FormVentasDia from '@/components/formularios/FormVentasDia';
import FormEgreso from '@/components/formularios/FormEgreso';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const EFECTIVO = ['efectivo', 'caja_menor'];

function TablaEgresos({ filas }) {
  if (!filas.length) return <Vacio>Sin egresos este mes.</Vacio>;
  return (
    <div className="tabla-cont tabla-dias"><table className="tarjetas">
      <thead><tr><th>Fecha</th><th>Motivo <span className="muted">(toca para corregir)</span></th><th>Bolsillo</th><th>Categoría</th><th className="n">Monto</th></tr></thead>
      <tbody>{filas.map(m => (
        <tr key={m.id}>
          <td className="nw" data-label="📅">{fecha(m.fecha).slice(0, 5)}</td>
          <td className="t-tit"><Link href={`/libro/movimiento/${m.id}`} className="link-editar" title="Corregir o anular">{m.concepto}</Link>{m.adjuntos > 0 && <Link href={`/libro/movimiento/${m.id}`} className="clip" title="Tiene comprobante">📎{m.adjuntos > 1 ? m.adjuntos : ''}</Link>}{(m.tercero || m.gasto_fijo || m.pedido || m.cuenta_si_varias) &&
            <div className="muted">{[m.cuenta_si_varias, m.tercero, m.gasto_fijo, m.pedido].filter(Boolean).join(' · ')}</div>}</td>
          <td data-label="Bolsillo">{m.bolsillo}</td>
          <td className="muted">{m.categoria ?? '—'}</td>
          <td className="n t-mon">{cop(m.monto)}</td>
        </tr>))}
      </tbody>
      <tfoot><tr><td colSpan={4} className="t-tit">Total</td><td className="n t-mon">{cop(filas.reduce((s, m) => s + m.monto, 0))}</td></tr></tfoot>
    </table></div>
  );
}

export default async function Libro({ searchParams }) {
  const { empresa, mes, mesInicio, sp } = await requerir(searchParams, 'libro');
  const e = empresa.id;
  const [movs, cuentas, bolsillos, categorias, proveedores, gastosFijos, ventasDia, resumenBolsillos, creditos] = await Promise.all([
    sql(`select m.id, m.fecha, m.tipo, m.clase, m.monto, m.concepto, c.nombre cuenta, c.tipo cuenta_tipo, b.codigo bolsillo,
            cg.nombre categoria, t.nombre tercero, g.concepto gasto_fijo, p.numero pedido,
            (select count(*)::int from comprobantes x where x.movimiento_id = m.id) adjuntos
         from movimientos m join cuentas c on c.id = m.cuenta_id
         left join bolsillos b on b.id = m.bolsillo_id left join categorias_gasto cg on cg.id = m.categoria_id
         left join terceros t on t.id = m.tercero_id left join gastos_fijos g on g.id = m.gasto_fijo_id
         left join pedidos p on p.id = m.pedido_id
         where m.empresa_id = $1 and date_trunc('month', m.fecha) = $2::date
         order by m.fecha desc, m.creado_en desc`, [e, mesInicio]),
    sql(`select id, nombre, tipo from cuentas where empresa_id = $1 and activa order by (nombre = 'Bancos') desc, tipo, nombre`, [e]),
    sql('select id, codigo, nombre from bolsillos where empresa_id = $1 order by orden', [e]),
    sql('select id, nombre from categorias_gasto where empresa_id = $1 and activa order by nombre', [e]),
    sql('select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre', [e]),
    sql('select id, concepto from gastos_fijos where (empresa_id = $1 or compartido) and activo order by concepto', [e]),
    sql(`select m.fecha, m.cuenta_id, c.tipo, sum(m.monto) monto from movimientos m join cuentas c on c.id = m.cuenta_id
         where m.empresa_id = $1 and date_trunc('month', m.fecha) = $2::date and m.tipo = 'ingreso' and m.clase = 'operacion'
           and m.concepto like 'Ventas del día%' group by 1, 2, 3`, [e, mesInicio]),
    // Bolsillos por medio (como la hoja): saldo anterior + entradas − salidas = saldo
    sql(`select b.codigo, b.nombre, b.orden,
           case when c.tipo in ('efectivo','caja_menor') then 'efectivo' else 'cuentas' end medio,
           coalesce(sum(mb.monto) filter (where m.fecha < $2 or m.clase = 'saldo_inicial'), 0) anterior,
           coalesce(sum(mb.monto) filter (where m.fecha >= $2 and m.clase <> 'saldo_inicial' and mb.monto > 0), 0) entra,
           coalesce(-sum(mb.monto) filter (where m.fecha >= $2 and m.clase <> 'saldo_inicial' and mb.monto < 0), 0) sale,
           coalesce(sum(mb.monto), 0) saldo
         from bolsillos b
         join movimiento_bolsillos mb on mb.bolsillo_id = b.id
         join movimientos m on m.id = mb.movimiento_id and m.fecha < ($2::date + interval '1 month')
         join cuentas c on c.id = m.cuenta_id
         where b.empresa_id = $1
         group by b.id, medio order by medio, b.orden`, [e, mesInicio]),
    sql(`select id, entidad || coalesce(' · ' || descripcion, '') nombre from creditos where empresa_id = $1 and activo order by entidad`, [e]),
  ]);

  // Ventas del día: mapa para el formulario y tabla día por día del mes
  const porDia = {};
  for (const v of ventasDia) (porDia[v.fecha] ??= {})[v.cuenta_id] = v.monto;
  const [a, m] = mes.split('-').map(Number);
  const diasMes = new Date(a, m, 0).getDate();
  const hoy = hoyCol();
  const filas = Array.from({ length: diasMes }, (_, i) => {
    const f = `${mes}-${String(i + 1).padStart(2, '0')}`;
    const del = ventasDia.filter(v => v.fecha === f);
    const ef = del.filter(v => EFECTIVO.includes(v.tipo)).reduce((s, v) => s + v.monto, 0);
    const bc = del.filter(v => !EFECTIVO.includes(v.tipo)).reduce((s, v) => s + v.monto, 0);
    return { f, dia: i + 1, sem: DIAS[new Date(a, m - 1, i + 1).getDay()], ef, bc, futuro: f > hoy };
  });
  const tEf = filas.reduce((s, x) => s + x.ef, 0), tBc = filas.reduce((s, x) => s + x.bc, 0);
  const diaElegido = /^\d{4}-\d{2}-\d{2}$/.test(sp.dia ?? '') ? sp.dia : (hoy.startsWith(mes) ? hoy : `${mes}-01`);

  // Egresos separados por medio, como "Registros de pago en efectivo" y "desde bancos"
  const cuentasEfectivo = cuentas.filter(c => c.tipo === 'efectivo');
  const cuentasBanco = cuentas.filter(c => ['banco', 'billetera'].includes(c.tipo));
  const egresos = movs.filter(x => x.tipo === 'egreso' && x.clase === 'operacion');
  const egEf = egresos.filter(x => EFECTIVO.includes(x.cuenta_tipo));
  const egBc = egresos.filter(x => !EFECTIVO.includes(x.cuenta_tipo)).map(x => ({ ...x, cuenta_si_varias: cuentasBanco.length > 1 ? x.cuenta : null }));
  const otros = movs.filter(x => !(x.tipo === 'egreso' && x.clase === 'operacion') && !x.concepto.startsWith('Ventas del día'));
  const comunes = { hoy, bolsillos, categorias, proveedores, gastosFijos, creditos };
  const bol = medio => resumenBolsillos.filter(r => r.medio === medio);

  return (
    <>
      <Encabezado titulo="Libro diario" sub={`${empresa.nombre} · ${nombreMes(mes)}`}>
        <SelectorMes mes={mes} ruta="/libro" />
        <Acciones excel={`/api/exportar?tipo=libro&mes=${mes}`} />
      </Encabezado>

      {sp.anulado && <p className="aviso ok">Registro anulado. Queda guardado en el historial de cambios.</p>}
      <h2 className="seccion">Ingresos: ventas del día</h2>
      <div className="dos">
        <section className="caja">
          <h2>Registrar ventas del día</h2>
          <FormVentasDia key={diaElegido} hoy={diaElegido} cuentaEfectivo={cuentasEfectivo[0]}
            cuentasBanco={cuentasBanco} porDia={porDia} />
        </section>
        <section className="caja">
          <h2>Ventas por día <small>toca un día para editarlo</small></h2>
          <div className="tabla-cont tabla-dias"><table>
            <thead><tr><th>Día</th><th className="n">💵 Efectivo</th><th className="n">🏦 Cuentas</th><th className="n">Total</th></tr></thead>
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

      <h2 className="seccion">Egresos: gastos y pagos</h2>
      <div className="dos">
        <section className="caja">
          <h2>💵 Pagos en efectivo <small>{cop(egEf.reduce((s, x) => s + x.monto, 0))} este mes</small></h2>
          <FormEgreso {...comunes} cuentas={cuentasEfectivo} />
          <TablaEgresos filas={egEf} />
        </section>
        <section className="caja">
          <h2>🏦 Pagos desde cuentas <small>{cop(egBc.reduce((s, x) => s + x.monto, 0))} este mes</small></h2>
          <FormEgreso {...comunes} cuentas={cuentasBanco} />
          <TablaEgresos filas={egBc} />
        </section>
      </div>

      <h2 className="seccion">Bolsillos</h2>
      <div className="dos">
        {[['efectivo', '💵 Efectivo'], ['cuentas', '🏦 Cuentas']].map(([medio, titulo]) => {
          const r = bol(medio);
          const t = k => r.reduce((s, x) => s + x[k], 0);
          return (
            <section className="caja" key={medio}>
              <h2>{titulo}</h2>
              {r.length === 0 ? <Vacio>Sin movimientos.</Vacio> : (
                <div className="tabla-cont"><table className="tarjetas">
                  <thead><tr><th>Bolsillo</th><th className="n">Venía</th><th className="n">Entró</th><th className="n">Salió</th><th className="n">Queda</th></tr></thead>
                  <tbody>{r.map(x => (
                    <tr key={x.codigo}><td className="t-tit"><b>{x.codigo}</b> <span className="muted">{x.nombre}</span></td>
                      <td className="n" data-label="Venía">{cop(x.anterior)}</td><td className="n pos" data-label="Entró">{cop(x.entra)}</td><td className="n" data-label="Salió">{cop(x.sale)}</td>
                      <td className={`n t-mon ${x.saldo < 0 ? 'neg' : ''}`}><b>{cop(x.saldo)}</b></td></tr>))}
                  </tbody>
                  <tfoot><tr><td className="t-tit">Total</td><td className="n" data-label="Venía">{cop(t('anterior'))}</td><td className="n" data-label="Entró">{cop(t('entra'))}</td>
                    <td className="n" data-label="Salió">{cop(t('sale'))}</td><td className={`n t-mon ${t('saldo') < 0 ? 'neg' : ''}`}>{cop(t('saldo'))}</td></tr></tfoot>
                </table></div>)}
            </section>
          );
        })}
      </div>

      <section className="caja">
        <details>
          <summary>Otros movimientos ({otros.length}): saldos iniciales, otros ingresos, traslados</summary>
          <div style={{ marginTop: 12 }}>
            <FormMovimiento hoy={hoy} cuentas={cuentas} bolsillos={bolsillos} categorias={categorias}
              proveedores={proveedores} gastosFijos={gastosFijos} />
            {otros.length > 0 && (
              <div className="tabla-cont" style={{ marginTop: 12 }}><table className="tarjetas">
                <thead><tr><th>Fecha</th><th>Concepto</th><th>Cuenta</th><th>Bolsillo</th><th className="n">Entra</th><th className="n">Sale</th></tr></thead>
                <tbody>{otros.map(x => (
                  <tr key={x.id}><td data-label="📅">{fecha(x.fecha)}</td><td className="t-tit"><Link href={`/libro/movimiento/${x.id}`} className="link-editar">{x.concepto}</Link><div className="muted">{x.clase.replace('_', ' ')}</div></td>
                    <td>{x.cuenta}</td><td data-label="Bolsillo">{x.bolsillo ?? <span className="muted">repartido</span>}</td>
                    <td className="n pos t-mon">{x.tipo === 'ingreso' ? `+${cop(x.monto)}` : ''}</td><td className="n t-mon">{x.tipo === 'egreso' ? cop(x.monto) : ''}</td></tr>))}
                </tbody>
              </table></div>)}
          </div>
        </details>
      </section>
    </>
  );
}
