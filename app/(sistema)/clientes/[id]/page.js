import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { cop, fecha } from '@/lib/formato';
import { Chip, Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarCliente } from '@/servidor/clientes';

const ESTADOS = { por_pedir: 'Por pedir', pedido: 'Pedido', en_camino: 'En camino', recibido_en_tienda: 'Recibido en tienda', entregado: 'Entregado', cancelado: 'Cancelado' };
const ETAPAS = { por_confirmar: 'Por confirmar', esperando_pago: 'Esperando pago', por_facturar: 'Por aplicar en factura', cerrada: 'Cerrada', rechazada: 'Rechazada' };

export default async function Cliente({ params, searchParams }) {
  const ctx = await requerir(searchParams, 'clientes');
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const c = await uno(`select * from terceros where id = $1 and es_cliente and empresa_id = any($2)`, [id, ctx.empresasCon('clientes')]);
  if (!c) notFound();
  const verPedidos = ctx.empresasCon('pedidos'), verVentas = [...new Set([...ctx.empresasCon('cartera'), ...ctx.empresasCon('revision'), ...ctx.empresasCon('ventas_ver_todas')])];
  const [pedidos, ventas] = await Promise.all([
    sql(`select vp.* from v_pedidos vp join pedidos p on p.id = vp.id where p.cliente_id = $1 and vp.empresa_id = any($2) order by vp.fecha_pedido desc`, [id, verPedidos]),
    sql(`select cc.* from v_cuentas_por_cobrar cc join ventas v on v.id = cc.venta_id where v.cliente_id = $1 and cc.empresa_id = any($2) order by cc.fecha_venta desc`, [id, verVentas]),
  ]);
  const totalPedidos = pedidos.filter(p => p.estado !== 'cancelado').reduce((s, p) => s + (p.valor ?? 0), 0);
  const debe = pedidos.filter(p => p.estado !== 'cancelado').reduce((s, p) => s + Math.max(p.saldo ?? 0, 0), 0);
  const totalVentas = ventas.filter(v => v.etapa !== 'rechazada').reduce((s, v) => s + v.monto, 0);

  return (
    <>
      <Encabezado titulo={c.nombre} sub={[c.documento && `CC/NIT ${c.documento}`, c.telefono].filter(Boolean).join(' · ') || 'Cliente'}>
        <Link href="/clientes" className="btn-sec btn-link">← Clientes</Link>
      </Encabezado>
      <section className="kpis">
        <div className="kpi"><div className="et">Pedidos bajo encargo</div><div className="va">{cop(totalPedidos)}</div><div className="de">{pedidos.length} pedido(s)</div></div>
        <div className="kpi"><div className="et">Saldo que debe de pedidos</div><div className={`va ${debe > 0 ? 'neg' : ''}`}>{cop(debe)}</div></div>
        <div className="kpi"><div className="et">Ventas financiadas</div><div className="va">{cop(totalVentas)}</div><div className="de">{ventas.length} venta(s)</div></div>
      </section>

      <section className="caja">
        <h2>Pedidos</h2>
        {pedidos.length === 0 ? <Vacio>Sin pedidos.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>N°</th><th>Fecha</th><th>Producto</th><th>Estado</th><th className="n">Valor</th><th className="n">Abonado</th><th className="n">Saldo</th></tr></thead>
            <tbody>{pedidos.map(p => (
              <tr key={p.id}><td><Link href={`/pedidos/${p.id}`}>{p.numero}</Link></td><td>{fecha(p.fecha_pedido)}</td><td>{p.producto ?? '—'}</td>
                <td><Chip>{ESTADOS[p.estado]}</Chip></td>
                <td className="n">{cop(p.valor)}</td><td className="n">{cop(p.abonado)}</td><td className="n">{cop(p.saldo)}</td></tr>))}
            </tbody>
          </table></div>)}
      </section>

      <section className="caja">
        <h2>Ventas financiadas</h2>
        {ventas.length === 0 ? <Vacio>Sin ventas financiadas.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Fecha</th><th>Factura</th><th>Producto</th><th>Entidad</th><th>Etapa</th><th className="n">Valor</th><th className="n">Pendiente</th></tr></thead>
            <tbody>{ventas.map(v => (
              <tr key={v.venta_pago_id}><td>{fecha(v.fecha_venta)}</td><td>{v.numero_factura ?? '—'}</td><td>{v.producto ?? '—'}</td><td>{v.entidad ?? v.forma}</td>
                <td><Chip>{ETAPAS[v.etapa] ?? v.etapa}</Chip></td>
                <td className="n">{cop(v.monto)}</td><td className="n">{cop(v.pendiente)}</td></tr>))}
            </tbody>
          </table></div>)}
      </section>

      <section className="caja no-imprimir">
        <h2>Datos del cliente</h2>
        <FormAccion action={guardarCliente} boton="Guardar cambios" limpiar={false}>
          <input type="hidden" name="id" value={c.id} />
                      <label>Nombre<input name="nombre" defaultValue={c.nombre} required /></label>
            <label>Cédula / NIT<input name="documento" defaultValue={c.documento ?? ''} /></label>
            <label>Teléfono<input name="telefono" defaultValue={c.telefono ?? ''} /></label>
            <label>Correo<input name="correo" type="email" defaultValue={c.correo ?? ''} /></label>
            <label>Dirección<input name="direccion" defaultValue={c.direccion ?? ''} /></label>
            <label>Notas<input name="notas" defaultValue={c.notas ?? ''} /></label>
        </FormAccion>
      </section>
    </>
  );
}
