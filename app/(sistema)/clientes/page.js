import Link from 'next/link';
import Acciones from '@/components/ui/Acciones';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { cop, fecha } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';

export default async function Clientes({ searchParams }) {
  const ctx = await requerir(searchParams, 'clientes');
  const ids = ctx.empresasCon('clientes');
  const q = String(ctx.sp.q ?? '').trim().slice(0, 60);
  const nombreEmpresa = Object.fromEntries(ctx.empresas.map(x => [x.id, x.nombre]));
  const lista = await sql(`
    select t.id, t.empresa_id, t.nombre, t.documento, t.telefono,
      (select count(*)::int from pedidos p where p.cliente_id = t.id) pedidos,
      (select count(*)::int from ventas v where v.cliente_id = t.id and v.revision <> 'rechazada') ventas,
      (select coalesce(sum(v.total), 0) from ventas v where v.cliente_id = t.id and v.revision <> 'rechazada')
        + coalesce((select sum(vp.valor) from v_pedidos vp join pedidos p on p.id = vp.id where p.cliente_id = t.id and vp.estado <> 'cancelado'), 0) comprado,
      greatest((select max(v.fecha) from ventas v where v.cliente_id = t.id), (select max(p.fecha_pedido) from pedidos p where p.cliente_id = t.id)) ultima
    from terceros t
    where t.es_cliente and t.empresa_id = any($1)
      and ($2 = '' or t.nombre ilike '%' || $2 || '%' or t.documento ilike '%' || $2 || '%' or t.telefono ilike '%' || $2 || '%')
    order by ultima desc nulls last, t.nombre limit 300`, [ids, q]);

  return (
    <>
      <Encabezado titulo="Clientes" sub="Quién compra, qué ha pedido y cuánto ha comprado">
        <Acciones excel="/api/exportar?tipo=clientes" />
      </Encabezado>
      <section className="caja">
        <form className="filtros no-imprimir" action="/clientes">
          <input name="q" defaultValue={q} placeholder="Buscar por nombre, cédula o teléfono" style={{ minWidth: 260 }} />
          <button className="btn-sec">Buscar</button>
          {q && <Link href="/clientes">Quitar búsqueda</Link>}
        </form>
        {lista.length === 0 ? <Vacio>{q ? 'Ningún cliente coincide con la búsqueda.' : 'Todavía no hay clientes. Se crean solos al registrar ventas o pedidos.'}</Vacio> : (
          <div className="tabla-cont"><table className="tarjetas">
            <thead><tr><th>Cliente</th><th>Cédula</th><th>Teléfono</th>{ids.length > 1 && <th>Empresa</th>}<th className="n">Pedidos</th><th className="n">Ventas</th><th className="n">Ha comprado</th><th>Última compra</th></tr></thead>
            <tbody>{lista.map(c => (
              <tr key={c.id}>
                <td className="t-tit"><Link href={`/clientes/${c.id}`}><b>{c.nombre}</b></Link></td>
                <td data-label="CC">{c.documento ?? '—'}</td><td data-label="Tel.">{c.telefono ?? '—'}</td>
                {ids.length > 1 && <td className="muted">{nombreEmpresa[c.empresa_id]}</td>}
                <td className="n" data-label="Pedidos">{c.pedidos}</td><td className="n" data-label="Ventas">{c.ventas}</td>
                <td className="n t-mon">{cop(c.comprado)}</td><td data-label="Última">{fecha(c.ultima)}</td>
              </tr>))}
            </tbody>
          </table></div>)}
        {lista.length === 300 && <p className="muted">Se muestran los 300 más recientes. Usa la búsqueda para encontrar otros.</p>}
      </section>
    </>
  );
}
