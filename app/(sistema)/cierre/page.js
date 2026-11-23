import Link from 'next/link';
import Acciones from '@/components/ui/Acciones';
import { sql, uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { resumenMes } from '@/lib/resumenMes';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Encabezado, SelectorMes, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { cerrarMes, reabrirMes } from '@/servidor/cierre';

function Tabla({ filas, col, titulo }) {
  const total = filas.reduce((s, x) => s + x.monto, 0);
  return filas.length === 0 ? <Vacio>Nada este mes.</Vacio> : (
    <div className="tabla-cont"><table>
      <thead><tr><th>{titulo}</th><th className="n">Monto</th><th className="n">%</th></tr></thead>
      <tbody>{filas.map(x => <tr key={x[col]}><td>{x[col]}</td><td className="n">{cop(x.monto)}</td><td className="n">{total ? Math.round(x.monto / total * 100) : 0} %</td></tr>)}</tbody>
      <tfoot><tr><td>Total</td><td className="n">{cop(total)}</td><td /></tr></tfoot>
    </table></div>
  );
}

function Bolsillos({ bolsillos }) {
  return ['efectivo', 'cuentas'].map(medio => {
    const r = bolsillos.filter(b => b.medio === medio);
    return (
      <div key={medio}>
        <h3 className="subt">{medio === 'efectivo' ? '💵 Efectivo' : '🏦 Cuentas'}</h3>
        <div className="tabla-cont"><table><tbody>
          {r.map(b => <tr key={b.codigo}><td><b>{b.codigo}</b> <span className="muted">{b.nombre}</span></td><td className={`n ${b.saldo < 0 ? 'neg' : ''}`}>{cop(b.saldo)}</td></tr>)}
        </tbody><tfoot><tr><td>Total</td><td className="n">{cop(r.reduce((s, b) => s + b.saldo, 0))}</td></tr></tfoot></table></div>
      </div>
    );
  });
}

export default async function Cierre({ searchParams }) {
  const ctx = await requerir(searchParams, 'cierre');
  const { empresa, mes, mesInicio } = ctx;
  const e = empresa.id;
  const [cierre, historico, bolsillos] = await Promise.all([
    uno(`select c.*, coalesce(m.nombre, '—') quien from cierres_mes c left join lateral (select nombre from miembros where user_id = c.cerrado_por limit 1) m on true
         where c.empresa_id = $1 and c.mes = $2`, [e, mesInicio]),
    sql(`select mes, ventas, egresos, flujo_neto, saldo_real, compras_bolsillo_75, gastos_operativos, cartera_pendiente, proveedores_pendientes,
                (detalle->>'deudaBancos')::numeric deuda_bancos, detalle->'cuadre' cuadre
         from cierres_mes where empresa_id = $1 order by mes desc`, [e]),
    sql(`select id, codigo, nombre from bolsillos where empresa_id = $1 order by orden, codigo`, [e]),
  ]);
  // Si está cerrado se muestra la foto guardada; si no, los números de este momento
  const r = cierre ? { ...cierre.detalle, ventas: cierre.ventas, egresos: cierre.egresos, flujo: cierre.flujo_neto, saldoReal: cierre.saldo_real }
    : await resumenMes(e, mesInicio);
  const pendientes = cierre ? [] : [
    r.egresosSinCategoria > 0 && `${r.egresosSinCategoria} egresos sin categoría`,
    r.pagosSinProveedor > 0 && `${r.pagosSinProveedor} pagos de la categoría Proveedores sin proveedor asignado`,
    r.gastosFijosPendientes?.length > 0 && `${r.gastosFijosPendientes.length} gastos fijos sin pagar completos (${cop(r.gastosFijosPendientes.reduce((s, g) => s + Math.max(0, g.diferencia), 0))})`,
    r.ventasSinFactura > 0 && `${r.ventasSinFactura} ventas financiadas pagadas sin aplicar en factura`,
  ].filter(Boolean);

  return (
    <>
      <Encabezado titulo="Cierre de mes" sub={`${empresa.nombre} · ${nombreMes(mes)}`}>
        <SelectorMes mes={mes} ruta="/cierre" />
        <Acciones excel={`/api/exportar?tipo=cierre&mes=${mes}`} />
      </Encabezado>

      {cierre && (
        <section className="caja estado-cierre">
          <b>🔒 Mes cerrado</b> por {cierre.quien} el {new Date(cierre.cerrado_en).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}.
          Sus movimientos ya no se pueden cambiar. Estos son los números guardados al cerrar.
          {ctx.esAdmin && (
            <FormAccion action={reabrirMes} boton="Reabrir mes" className="mini" limpiar={false}
              confirmar={`¿Reabrir ${nombreMes(mes)}? Se podrán volver a cambiar sus movimientos.`}>
              <input type="hidden" name="mes" value={mes} />
            </FormAccion>)}
        </section>
      )}

      <section className="kpis">
        <div className="kpi"><div className="et">Ventas</div><div className="va">{cop(r.ventas)}</div>
          <div className="de">{r.ventasEfectivo !== undefined && `Efectivo ${cop(r.ventasEfectivo)} · Cuentas ${cop(r.ventasBanco)}`}</div></div>
        <div className="kpi"><div className="et">Egresos</div><div className="va">{cop(r.egresos)}</div></div>
        <div className="kpi"><div className="et">Flujo neto</div><div className={`va ${r.flujo < 0 ? 'neg' : 'pos'}`}>{cop(r.flujo)}</div></div>
        <div className="kpi"><div className="et">Saldo real (caja + banco)</div><div className={`va ${r.saldoReal < 0 ? 'neg' : ''}`}>{cop(r.saldoReal)}</div></div>
        {r.meta && <div className="kpi"><div className="et">Meta</div><div className="va">{Math.round(r.ventas / r.meta * 100)} %</div><div className="de">de {cop(r.meta)}</div></div>}
      </section>

      <div className="dos">
        <section className="caja"><h2>Egresos por tipo</h2><Tabla filas={r.porTipo ?? []} col="tipo" titulo="Tipo" /></section>
        <section className="caja"><h2>Egresos por categoría</h2><Tabla filas={r.porCategoria ?? []} col="categoria" titulo="Categoría" /></section>
      </div>

      <div className="dos">
        <section className="caja">
          <h2>Deudas al cierre</h2>
          <div className="tabla-cont"><table><tbody>
            <tr><td>Con proveedores</td><td className="n neg">{cop(r.deudaProveedores)}</td><td><Link href="/proveedores" className="muted">ver</Link></td></tr>
            <tr><td>Con bancos y tarjetas</td><td className="n neg">{cop(r.deudaBancos)}</td><td><Link href="/creditos" className="muted">ver</Link></td></tr>
            <tr><td>Por cobrar a entidades (Addi, Sumas Pay…)</td><td className="n pos">{cop(r.carteraPendiente)}</td><td><Link href="/cartera" className="muted">ver</Link></td></tr>
          </tbody></table></div>
          <h3 className="subt">Compras a crédito del mes</h3>
          <Tabla filas={r.comprasCredito ?? []} col="destino" titulo="Para qué" />
        </section>
        <section className="caja">
          <h2>Bolsillos al cierre</h2>
          <Bolsillos bolsillos={r.bolsillos ?? []} />
        </section>
      </div>

      {cierre ? (
        <section className="caja">
          <h2>Cuadre guardado</h2>
          <div className="tabla-cont"><table>
            <thead><tr><th>Medio</th><th className="n">Según libro</th><th className="n">Contado</th><th className="n">Diferencia</th></tr></thead>
            <tbody>{[['💵 Efectivo', r.cuadre?.efectivo], ['🏦 Banco', r.cuadre?.banco]].map(([t, c]) => c && (
              <tr key={t}><td>{t}</td><td className="n">{cop(c.libro)}</td><td className="n">{cop(c.contado)}</td>
                <td className={`n ${Math.abs(c.diferencia) > 1000 ? 'neg' : 'pos'}`}>{cop(c.diferencia)}{Math.abs(c.diferencia) <= 1000 ? ' ✓' : ''}{c.ajustado ? ' · ajustado' : ''}</td></tr>))}
            </tbody></table></div>
          {r.nota && <p className="muted">Nota: {r.nota}</p>}
        </section>
      ) : (
        <section className="caja">
          <h2>Cuadre y cierre</h2>
          {pendientes.length > 0 && (
            <div className="aviso error" style={{ marginBottom: 12 }}>
              <b>Antes de cerrar, revisa:</b>
              <ul style={{ margin: '6px 0 0 18px', padding: 0 }}>{pendientes.map(p => <li key={p}>{p}</li>)}</ul>
            </div>)}
          <p className="muted" style={{ marginTop: 0 }}>Cuenta el efectivo y mira el saldo del banco (extracto o app). Escríbelos aquí: la app los compara con el libro y guarda la diferencia.</p>
          <FormAccion action={cerrarMes} boton={`Cerrar ${nombreMes(mes)}`} limpiar={false}
            confirmar={`¿Cerrar ${nombreMes(mes)}? Después ya no se podrán cambiar sus movimientos (solo un administrador puede reabrirlo).`}>
            <input type="hidden" name="mes" value={mes} />
            <label>💵 Efectivo contado<input name="efectivo_contado" inputMode="numeric" required placeholder={`Libro: ${cop(r.saldoEfectivo)}`} /></label>
            <label>🏦 Saldo en el banco<input name="banco_contado" inputMode="numeric" required placeholder={`Libro: ${cop(r.saldoBanco)}`} /></label>
            <label>Inventario final (opcional)<input name="inventario_final" inputMode="numeric" /></label>
            <label className="ancho">Nota<input name="nota" placeholder="Ej. diferencia por domicilio sin registrar" /></label>
            <label className="casilla ancho"><input type="checkbox" name="ajustar" />
              <span>Ajustar el libro al conteo <small>Si hay diferencia, se registra un ajuste el último día del mes para que el mes siguiente arranque con lo que de verdad hay.</small></span></label>
            <label>Bolsillo del ajuste<select name="bolsillo_ajuste" defaultValue={bolsillos[bolsillos.length - 1]?.id}>
              {bolsillos.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select></label>
          </FormAccion>
          <p className="muted">Según el libro hoy: efectivo <b>{cop(r.saldoEfectivo)}</b> · banco <b>{cop(r.saldoBanco)}</b>. El mes siguiente arranca solo con estos saldos en cada bolsillo.</p>
        </section>
      )}

      <section className="caja">
        <h2>Histórico de cierres</h2>
        {historico.length === 0 ? <Vacio>Todavía no hay meses cerrados.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Mes</th><th className="n">Ventas</th><th className="n">Egresos</th><th className="n">Flujo</th><th className="n">Saldo real</th>
              <th className="n">Compras (75)</th><th className="n">Gastos operativos</th><th className="n">Deuda proveedores</th><th className="n">Deuda bancos</th><th>Cuadre</th></tr></thead>
            <tbody>{historico.map(h => {
              const dif = h.cuadre ? (h.cuadre.efectivo?.diferencia ?? 0) + (h.cuadre.banco?.diferencia ?? 0) : null;
              return (
                <tr key={h.mes}>
                  <td className="nw"><Link href={`/cierre?mes=${String(h.mes).slice(0, 7)}`}>{nombreMes(String(h.mes).slice(0, 7))}</Link></td>
                  <td className="n">{cop(h.ventas)}</td><td className="n">{cop(h.egresos)}</td>
                  <td className={`n ${h.flujo_neto < 0 ? 'neg' : 'pos'}`}>{cop(h.flujo_neto)}</td><td className="n">{cop(h.saldo_real)}</td>
                  <td className="n">{cop(h.compras_bolsillo_75)}</td><td className="n">{cop(h.gastos_operativos)}</td>
                  <td className="n">{cop(h.proveedores_pendientes)}</td><td className="n">{h.deuda_bancos === null ? '—' : cop(h.deuda_bancos)}</td>
                  <td>{dif === null ? <span className="muted">de la hoja</span> : Math.abs(dif) <= 1000 ? <span className="pos">cuadró</span> : <span className="neg">{cop(dif)}</span>}</td>
                </tr>);
            })}</tbody>
          </table></div>)}
      </section>
    </>
  );
}
