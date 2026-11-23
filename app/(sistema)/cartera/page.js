import Link from 'next/link';
import Acciones from '@/components/ui/Acciones';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Chip, Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { anularCobro, editarVenta, marcarAplicado, registrarCobro, revisarVenta } from '@/servidor/ventas';

const ETAPAS = [
  ['por_confirmar', '1. Por confirmar', 'Registradas: verifica que la venta aparezca en la plataforma de la entidad.'],
  ['esperando_pago', '2. Esperando pago', 'Confirmadas en la plataforma: falta que la entidad consigne a tu cuenta.'],
  ['por_facturar', '3. Por aplicar en factura', 'La plata ya llegó: falta aplicarla a la factura en el sistema contable.'],
  ['cerrada', '4. Cerradas', 'Aplicadas en la factura.'],
  ['rechazada', 'Rechazadas', 'No correspondían o se anularon.'],
];
const REGLA = { dias_calendario: 'días calendario', dia_fijo_mes: 'día fijo del mes siguiente', dias_habiles: 'días hábiles', sin_fecha: 'sin fecha fija' };

export default async function Seguimiento({ searchParams }) {
  const ctx = await requerir(searchParams);
  const puedeConfirmar = ctx.puede('revision');
  const puedeCobrar = ctx.puede('cartera');
  if (!puedeConfirmar && !puedeCobrar) redirect('/sin-permiso');
  const e = ctx.empresa.id;
  // Compartido entre las empresas donde la persona confirma o registra pagos
  const ids = [...new Set([...ctx.empresasCon('cartera'), ...ctx.empresasCon('revision')])];
  const nombreEmpresa = Object.fromEntries(ctx.empresas.map(x => [x.id, x.nombre]));
  const varias = ids.length > 1;
  const [ventas, entidades, cuentasTodas, cobros] = await Promise.all([
    sql(`select * from v_cuentas_por_cobrar where empresa_id = any($1) order by fecha_estimada_pago nulls last, fecha_venta, creado_en`, [ids]),
    sql(`select ef.nombre, ef.regla, ef.valor, ef.dia_corte, x.*
         from (select distinct on (nombre) nombre, regla, valor, dia_corte from entidades_financiacion
               where empresa_id = any($1) order by nombre, (empresa_id = $2) desc) ef
         cross join lateral (
           select count(c.venta_pago_id) filter (where c.etapa <> 'rechazada') n,
             coalesce(sum(c.monto) filter (where c.etapa <> 'rechazada'), 0) vendido,
             coalesce(sum(c.pendiente) filter (where c.etapa in ('por_confirmar','esperando_pago')), 0) pendiente,
             coalesce(sum(c.monto) filter (where c.etapa = 'por_facturar'), 0) por_facturar,
             count(*) filter (where c.estado = 'Vencido') vencidas
           from v_cuentas_por_cobrar c where c.entidad = ef.nombre and c.empresa_id = any($1)) x
         order by ef.nombre`, [ids, e]),
    sql(`select id, empresa_id, nombre, tipo from cuentas where empresa_id = any($1) and activa and tipo in ('banco','billetera') order by (nombre = 'Bancos') desc, nombre`, [ids]),
    sql(`select c.id, c.venta_pago_id, c.fecha, c.monto, cu.nombre cuenta from cobros c left join cuentas cu on cu.id = c.cuenta_id
         join venta_pagos vp on vp.id = c.venta_pago_id join ventas v on v.id = vp.venta_id where v.empresa_id = any($1) order by c.fecha`, [ids]),
  ]);
  const cobrosDe = vp => cobros.filter(c => c.venta_pago_id === vp);
  const cuentasDe = empresaId => cuentasTodas.filter(c => c.empresa_id === empresaId);
  const conteo = Object.fromEntries(ETAPAS.map(([k]) => [k, ventas.filter(v => v.etapa === k).length]));
  const porDefecto = ETAPAS.find(([k]) => k !== 'cerrada' && k !== 'rechazada' && conteo[k])?.[0] ?? 'esperando_pago';
  const etapa = ETAPAS.some(([k]) => k === ctx.sp.etapa) ? ctx.sp.etapa : porDefecto;
  const lista = ventas.filter(v => v.etapa === etapa);
  const [, tituloEtapa, ayuda] = ETAPAS.find(([k]) => k === etapa);
  const t = k => entidades.reduce((s, x) => s + x[k], 0);
  const hoyCol = hoy();

  return (
    <>
      <Encabezado titulo="Seguimiento de ventas" sub={`${varias ? 'Las dos empresas' : ctx.empresa.nombre} · Addi, Sumas Pay, cooperativas y tarjeta de crédito`}>
        <Acciones excel="/api/exportar?tipo=ventas" />
      </Encabezado>

      <section className="caja">
        <h2>Por entidad</h2>
        <div className="tabla-cont"><table>
          <thead><tr><th>Entidad</th><th>Paga a</th><th className="n">Ventas</th><th className="n">Vendido</th>
            <th className="n">Pendiente de pago</th><th className="n">Pagado, falta factura</th><th className="n">Vencidas</th></tr></thead>
          <tbody>{entidades.map(x => (
            <tr key={x.nombre}>
              <td><b>{x.nombre}</b></td>
              <td className="muted">{x.regla === 'sin_fecha' ? REGLA.sin_fecha : x.regla === 'dia_fijo_mes'
                ? `día ${x.valor} del mes siguiente (corte ${x.dia_corte})` : `${x.valor} ${REGLA[x.regla]}`}</td>
              <td className="n">{x.n}</td><td className="n">{cop(x.vendido)}</td>
              <td className="n">{cop(x.pendiente)}</td><td className="n">{cop(x.por_facturar)}</td>
              <td className={`n ${x.vencidas ? 'neg' : ''}`}>{x.vencidas}</td>
            </tr>))}
          </tbody>
          <tfoot><tr><td>Total</td><td /><td className="n">{t('n')}</td><td className="n">{cop(t('vendido'))}</td>
            <td className="n">{cop(t('pendiente'))}</td><td className="n">{cop(t('por_facturar'))}</td><td className="n">{t('vencidas')}</td></tr></tfoot>
        </table></div>
      </section>

      <nav className="etapas">
        {ETAPAS.map(([k, txt]) => (
          <Link key={k} href={`/cartera?etapa=${k}`} className={etapa === k ? 'activo' : ''}>
            {txt} <span className="n-etapa">{conteo[k]}</span>
          </Link>
        ))}
      </nav>

      <section className="caja">
        <h2>{tituloEtapa} <small>{ayuda}</small></h2>
        {lista.length === 0 ? <Vacio>No hay ventas en esta etapa.</Vacio> : (
          <div className="tarjetas-venta">
            {lista.map(v => (
              <article className="tarjeta-venta" key={v.venta_pago_id}>
                <div className="tv-cab">
                  <div>
                    <b>{v.entidad}</b> · {cop(v.monto)}
                    <div className="muted">{v.producto ?? 'Sin producto'}{v.numero_factura && ` · factura ${v.numero_factura}`}</div>
                    {varias && <span className="etiqueta-rol" style={{ marginTop: 4, display: 'inline-block' }}>{nombreEmpresa[v.empresa_id]}</span>}
                  </div>
                  <Chip>{v.etapa !== 'por_confirmar' && v.estado === 'Por confirmar' ? 'Sin fecha de pago' : v.estado}</Chip>
                </div>
                <div className="tv-datos">
                  <span>Cliente: <b>{v.cliente ?? '—'}</b>{v.documento && ` · CC ${v.documento}`}</span>
                  <span>Vendió: {v.vendedor ?? '—'} · venta {fecha(v.fecha_venta)}</span>
                  {v.referencia && <span>Ref. / aprobación: <b>{v.referencia}</b></span>}
                  <span>Pago estimado: {v.fecha_estimada_pago ? fecha(v.fecha_estimada_pago) : 'por confirmar'}</span>
                  {v.recibido > 0 && <span>Recibido: <b>{cop(v.recibido)}</b>{v.fecha_pago_real && ` el ${fecha(v.fecha_pago_real)}`}{v.cuenta_pago && ` en ${v.cuenta_pago}`}{v.pendiente > 0 && ` · faltan ${cop(v.pendiente)}`}</span>}
                  {v.aplicado_en && <span>Aplicada en factura el {fecha(new Date(v.aplicado_en).toISOString())}</span>}
                  {v.nota_revision && <span className="muted">Nota: {v.nota_revision}</span>}
                  {puedeCobrar && cobrosDe(v.venta_pago_id).map(c => (
                    <div key={c.id} className="mini">
                      <span className="muted">Pago {fecha(c.fecha)} · {cop(c.monto)}{c.cuenta && ` · ${c.cuenta}`}</span>
                      <FormAccion action={anularCobro} boton="Anular pago" className="mini" limpiar={false} confirmar="¿Anular este pago? La venta vuelve a quedar pendiente por ese valor.">
                        <input type="hidden" name="cobro_id" value={c.id} />
                      </FormAccion>
                    </div>))}
                </div>

                <div className="tv-acciones">
                  {v.etapa === 'por_confirmar' && (puedeConfirmar ? <>
                    <FormAccion action={revisarVenta} boton="✓ Ya aparece en la plataforma" className="mini" limpiar={false}>
                      <input type="hidden" name="venta_id" value={v.venta_id} /><input type="hidden" name="decision" value="aprobada" />
                    </FormAccion>
                    <details><summary>Rechazar</summary>
                      <FormAccion action={revisarVenta} boton="Rechazar" className="mini" limpiar={false} confirmar="¿Rechazar esta venta?">
                        <input type="hidden" name="venta_id" value={v.venta_id} /><input type="hidden" name="decision" value="rechazada" />
                        <input name="nota" placeholder="Motivo (lo ve el vendedor)" required style={{ width: 220 }} />
                      </FormAccion>
                    </details>
                  </> : <span className="muted">Esperando que el administrador la confirme.</span>)}

                  {v.etapa === 'esperando_pago' && puedeCobrar && (
                    <FormAccion action={registrarCobro} boton="Registrar pago recibido" className="mini">
                      <input type="hidden" name="venta_pago_id" value={v.venta_pago_id} />
                      <input type="date" name="fecha" defaultValue={hoyCol} required aria-label="Fecha en que llegó" />
                      <input name="monto" defaultValue={v.pendiente} inputMode="numeric" required aria-label="Monto recibido" />
                      <select name="cuenta_id" defaultValue={cuentasDe(v.empresa_id)[0]?.id} aria-label="Cuenta donde llegó">
                        {cuentasDe(v.empresa_id).map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
                    </FormAccion>
                  )}

                  {v.etapa === 'por_facturar' && puedeCobrar && (
                    <FormAccion action={marcarAplicado} boton="Aplicar en factura y cerrar" className="mini" limpiar={false}>
                      <input type="hidden" name="venta_pago_id" value={v.venta_pago_id} /><input type="hidden" name="valor" value="si" />
                      <input name="numero_factura" defaultValue={v.numero_factura ?? ''} placeholder="N° de factura" required style={{ width: 140 }} />
                    </FormAccion>
                  )}

                  {puedeConfirmar && v.etapa !== 'cerrada' && (
                    <details><summary>Corregir datos</summary>
                      <FormAccion action={editarVenta} boton="Guardar" className="formulario" limpiar={false}>
                        <input type="hidden" name="venta_id" value={v.venta_id} />
                        <label>Fecha<input type="date" name="fecha" defaultValue={v.fecha_venta} required /></label>
                        <label>Valor<input name="total" defaultValue={v.monto} inputMode="numeric" required /></label>
                        <label>Factura<input name="numero_factura" defaultValue={v.numero_factura ?? ''} /></label>
                        <label className="ancho">Producto<input name="producto" defaultValue={v.producto ?? ''} required /></label>
                        <label>Aprobación / ID<input name="referencia" defaultValue={v.referencia ?? ''} /></label>
                        <label>Canal<input name="detalle" defaultValue={v.detalle ?? ''} /></label>
                      </FormAccion>
                    </details>
                  )}
                  {v.etapa === 'cerrada' && puedeCobrar && (
                    <FormAccion action={marcarAplicado} boton="Reabrir" className="mini" limpiar={false} confirmar="¿Reabrir esta venta? Vuelve a 'por aplicar en factura'.">
                      <input type="hidden" name="venta_pago_id" value={v.venta_pago_id} /><input type="hidden" name="valor" value="no" />
                    </FormAccion>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}
        {etapa === 'esperando_pago' && <p className="muted">El pago queda registrado para el control de la venta. La plata entra a la caja con las ventas del día (cuentas) en el Libro diario.</p>}
      </section>
    </>
  );
}
