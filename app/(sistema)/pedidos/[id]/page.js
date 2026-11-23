import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Chip, Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { abonarPedido, actualizarPedido, guardarItem, pagarProveedorPedido } from '@/servidor/pedidos';

const ESTADOS = [['por_pedir', 'Por pedir'], ['pedido', 'Pedido'], ['en_camino', 'En camino'], ['recibido_en_tienda', 'Recibido en tienda'], ['entregado', 'Entregado'], ['cancelado', 'Cancelado']];

export default async function Pedido({ params, searchParams }) {
  const { id } = await params;
  const ctx = await requerir(searchParams, 'pedidos');
  const verCostos = ctx.puede('pedidos_costos');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const e = ctx.empresa.id;  // la plata (abonos y pagos) se registra en la empresa activa
  const p = await uno('select v.*, p.proveedor_id, p.abonado_previo from v_pedidos v join pedidos p on p.id = v.id where v.id = $1 and v.empresa_id = any($2)', [id, ctx.empresasCon('pedidos')]);
  if (!p) notFound();
  const [items, historial, proveedores, proveedoresActiva, cuentas, bolsillos] = await Promise.all([
    sql('select id, descripcion, cantidad, precio_venta from pedido_items where pedido_id = $1 order by descripcion', [id]),
    sql(`select a.fecha, 'Abono del cliente' concepto, a.monto, 'entra' sentido, c.nombre cuenta, m.nombre quien, a.creado_en
         from pedido_abonos a left join cuentas c on c.id = a.cuenta_id left join lateral (select nombre from miembros where user_id = a.registrado_por limit 1) m on true
         where a.pedido_id = $1
         union all
         select mv.fecha, mv.concepto, mv.monto, 'sale', c.nombre, m.nombre, mv.creado_en from movimientos mv
         join cuentas c on c.id = mv.cuenta_id left join lateral (select nombre from miembros where user_id = mv.creado_por limit 1) m on true
         where mv.pedido_id = $1 and mv.tipo = 'egreso' and $2
         order by 1, 7`, [id, verCostos]),
    sql('select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre', [p.empresa_id]),
    sql('select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre', [e]),
    sql('select id, nombre, tipo from cuentas where empresa_id = $1 and activa order by tipo, nombre', [e]),
    verCostos ? sql('select id, codigo, nombre from bolsillos where empresa_id = $1 order by orden', [e]) : [],
  ]);
  const hoyCol = hoy();
  const efectivo = cuentas.find(c => c.tipo === 'efectivo')?.id;
  const banco = cuentas.find(c => c.tipo === 'banco')?.id;

  return (
    <>
      <Encabezado titulo={`${p.numero} · ${p.producto ?? ''}`} sub={`${p.cliente ?? 'Sin cliente'}${p.telefono ? ' · ' + p.telefono : ''} · pedido el ${fecha(p.fecha_pedido)}`}>
        <Chip>{p.alerta}</Chip>
        <Link href="/pedidos" className="btn-sec btn-link">Volver</Link>
      </Encabezado>

      <section className="kpis">
        <div className="kpi"><div className="et">Valor</div><div className="va">{cop(p.valor)}</div></div>
        <div className="kpi"><div className="et">Abonado</div><div className="va">{cop(p.abonado)}</div>
          {p.abonado_previo > 0 && <div className="de">{cop(p.abonado_previo)} de antes del sistema</div>}</div>
        <div className="kpi"><div className="et">Saldo del cliente</div><div className={`va ${p.saldo > 0 ? 'neg' : ''}`}>{cop(p.saldo)}</div></div>
        {verCostos && <>
          <div className="kpi"><div className="et">Pagado al proveedor</div><div className="va">{cop(p.costo_pagado)}</div></div>
          <div className="kpi"><div className="et">Utilidad</div><div className="va">{p.utilidad === null ? '—' : cop(p.utilidad)}</div>
            <div className="de">{p.utilidad === null ? 'Falta valor o pago al proveedor' : 'Valor − pagado al proveedor'}</div></div>
        </>}
      </section>

      <div className="dos">
        <section className="caja">
          <h2>Estado y entrega</h2>
          <FormAccion action={actualizarPedido} boton="Guardar cambios" limpiar={false}>
            <input type="hidden" name="pedido_id" value={p.id} />
            <label>Estado<select name="estado" defaultValue={p.estado}>{ESTADOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></label>
            <label>Entrega estimada<input type="date" name="fecha_estimada" defaultValue={p.fecha_estimada ?? ''} /></label>
            <label>Entregado el (si aplica)<input type="date" name="fecha_entrega_real" defaultValue={p.fecha_entrega_real ?? ''} /></label>
            <label>Proveedor<select name="proveedor_id" defaultValue={p.proveedor_id ?? ''}>
              <option value="">—</option>{proveedores.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
            <label className="ancho">Observaciones<input name="observaciones" defaultValue={p.observaciones ?? ''} /></label>
          </FormAccion>
        </section>

        <section className="caja">
          <h2>Productos</h2>
          {items.map(it => (
            <FormAccion key={it.id} action={guardarItem} boton="Guardar" className="mini" limpiar={false}>
              <input type="hidden" name="pedido_id" value={p.id} /><input type="hidden" name="item_id" value={it.id} />
              <input name="descripcion" defaultValue={it.descripcion} style={{ width: 220 }} aria-label="Descripción" />
              <input name="cantidad" defaultValue={it.cantidad} style={{ width: 60 }} aria-label="Cantidad" />
              <input name="precio_venta" defaultValue={it.precio_venta ?? ''} placeholder="Valor" aria-label="Valor" />
            </FormAccion>
          ))}
          <details style={{ marginTop: 10 }}><summary>+ Agregar otro producto</summary>
            <FormAccion action={guardarItem} boton="Agregar" className="mini">
              <input type="hidden" name="pedido_id" value={p.id} />
              <input name="descripcion" placeholder="Descripción" style={{ width: 220 }} required />
              <input name="cantidad" defaultValue="1" style={{ width: 60 }} />
              <input name="precio_venta" placeholder="Valor" />
            </FormAccion>
          </details>
        </section>
      </div>

      <div className="dos">
        <section className="caja">
          <h2>Registrar abono del cliente</h2>
          <FormAccion action={abonarPedido} boton="Registrar abono">
            <input type="hidden" name="pedido_id" value={p.id} />
            <label>Fecha<input type="date" name="fecha" defaultValue={hoyCol} required /></label>
            <label>Monto<input name="monto" inputMode="numeric" defaultValue={p.saldo > 0 ? p.saldo : ''} required /></label>
            <label>Medio<select name="cuenta_id" defaultValue={efectivo}>{cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          </FormAccion>
          <p className="muted">Medio de {ctx.empresa.nombre}. Es un registro de control del pedido. La plata entra a la caja con el total del día en el Libro diario.</p>
        </section>
        {verCostos && (
          <section className="caja">
            <h2>Registrar pago al proveedor</h2>
            <FormAccion action={pagarProveedorPedido} boton="Registrar pago">
              <input type="hidden" name="pedido_id" value={p.id} />
              <label>Fecha<input type="date" name="fecha" defaultValue={hoyCol} required /></label>
              <label>Monto<input name="monto" inputMode="numeric" required /></label>
              <label>Sale de<select name="cuenta_id" defaultValue={banco}>{cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
              <label>Bolsillo<select name="bolsillo_id" defaultValue={bolsillos[0]?.id}>{bolsillos.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select></label>
              <label>Proveedor<select name="proveedor_id" defaultValue={proveedoresActiva.some(x => x.id === p.proveedor_id) ? p.proveedor_id : ''}>
                <option value="">—</option>{proveedoresActiva.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
            </FormAccion>
            <p className="muted">Sale de la caja de <b>{ctx.empresa.nombre}</b>: queda en el Libro diario como egreso “Pedidos de clientes”, ligado a este pedido.</p>
          </section>
        )}
      </div>

      <section className="caja">
        <h2>Historial de este pedido</h2>
        {historial.length === 0 ? <Vacio>{p.abonado_previo > 0 ? `El abono de ${cop(p.abonado_previo)} se registró antes, en la hoja.` : 'Todavía no hay abonos ni pagos.'}</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Fecha</th><th>Concepto</th><th>Medio / cuenta</th><th>Registró</th><th className="n">Entra</th><th className="n">Sale</th></tr></thead>
            <tbody>{historial.map((m, i) => (
              <tr key={i}><td>{fecha(m.fecha)}</td><td>{m.concepto}</td><td>{m.cuenta ?? '—'}</td><td>{m.quien ?? '—'}</td>
                <td className="n pos">{m.sentido === 'entra' ? cop(m.monto) : ''}</td><td className="n">{m.sentido === 'sale' ? cop(m.monto) : ''}</td></tr>))}
            </tbody>
          </table></div>)}
      </section>
    </>
  );
}
