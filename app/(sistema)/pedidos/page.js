import Link from 'next/link';
import Acciones from '@/components/ui/Acciones';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Chip, Encabezado, Vacio } from '@/components/ui/Comunes';

const ESTADOS = { por_pedir: 'Por pedir', pedido: 'Pedido', en_camino: 'En camino', recibido_en_tienda: 'Recibido en tienda', entregado: 'Entregado', cancelado: 'Cancelado' };
const FILTROS = [['abiertos', 'Abiertos'], ['todos', 'Todos'], ['entregado', 'Entregados']];

export default async function Pedidos({ searchParams }) {
  const ctx = await requerir(searchParams, 'pedidos');
  const { sp } = ctx;
  const ids = ctx.empresasCon('pedidos');
  const nombreEmpresa = Object.fromEntries(ctx.empresas.map(x => [x.id, x.nombre]));
  const varias = ids.length > 1;
  const filtro = FILTROS.some(([v]) => v === sp.ver) ? sp.ver : 'abiertos';
  const todos = await sql(`select * from v_pedidos where empresa_id = any($1) order by numero desc`, [ids]);
  const lista = todos.filter(p => filtro === 'todos' || (filtro === 'entregado' ? p.estado === 'entregado' : !['entregado', 'cancelado'].includes(p.estado)));
  const cuenta = a => todos.filter(p => p.alerta === a).length;
  const porEstado = Object.keys(ESTADOS).map(k => [ESTADOS[k], todos.filter(p => p.estado === k).length]);

  return (
    <>
      <Encabezado titulo="Pedidos bajo encargo" sub={varias ? 'Compartidos: ' + ids.map(i => nombreEmpresa[i]).join(' y ') : nombreEmpresa[ids[0]]}>
        <Acciones excel="/api/exportar?tipo=pedidos" />
        <Link href="/pedidos/nuevo" className="btn btn-link">+ Nuevo pedido</Link>
      </Encabezado>
      <section className="kpis">
        <div className="kpi"><div className="et">Pedidos</div><div className="va">{todos.length}</div>
          <div className="de">{porEstado.filter(([, n]) => n).map(([e, n]) => `${e} ${n}`).join(' · ')}</div></div>
        <div className="kpi"><div className="et">Valor total</div><div className="va">{cop(todos.reduce((s, p) => s + (p.valor ?? 0), 0))}</div></div>
        <div className="kpi"><div className="et">Abonado</div><div className="va">{cop(todos.reduce((s, p) => s + p.abonado, 0))}</div></div>
        <div className="kpi"><div className="et">Saldo por cobrar</div><div className="va">{cop(todos.reduce((s, p) => s + (p.saldo ?? 0), 0))}</div>
          <div className="de">{todos.filter(p => p.saldo > 0).length} pedidos con saldo</div></div>
        <div className="kpi"><div className="et">Requieren atención</div><div className="va">{cuenta('ATRASADO') + cuenta('FALTA VALOR')}</div>
          <div className="de">{cuenta('ATRASADO')} atrasados · {cuenta('FALTA VALOR')} sin valor</div></div>
      </section>

      <section className="caja">
        <div className="filtros">
          {FILTROS.map(([v, t]) => <Link key={v} href={`/pedidos?ver=${v}`} className={filtro === v ? 'activo' : ''}>{t}</Link>)}
        </div>
        {lista.length === 0 ? <Vacio>No hay pedidos en esta vista.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>N°</th>{varias && <th>Empresa</th>}<th>Pedido</th><th>Producto</th><th>Cliente</th><th>Entrega estimada</th><th>Estado</th>
              <th className="n">Valor</th><th className="n">Abonado</th><th className="n">Saldo</th><th>Alerta</th></tr></thead>
            <tbody>{lista.map(p => (
              <tr key={p.id}>
                <td className="nw"><Link href={`/pedidos/${p.id}`}><b>{p.numero}</b></Link></td>
                {varias && <td className="muted nw">{nombreEmpresa[p.empresa_id]?.split(' ')[0]}</td>}
                <td className="nw">{fecha(p.fecha_pedido)}</td>
                <td className="prod">{p.producto}{p.observaciones && <div className="muted">{p.observaciones}</div>}</td>
                <td>{p.cliente ?? '—'}{p.telefono && <div className="muted">{p.telefono}</div>}</td>
                <td>{fecha(p.fecha_estimada)}{p.dias_para_entrega !== null && (
                  <div className={`muted ${p.dias_para_entrega < 0 ? 'neg' : ''}`}>{p.dias_para_entrega < 0 ? `${-p.dias_para_entrega} días tarde` : `faltan ${p.dias_para_entrega} días`}</div>)}</td>
                <td>{ESTADOS[p.estado]}</td>
                <td className="n">{cop(p.valor)}</td>
                <td className="n">{cop(p.abonado)}</td>
                <td className={`n ${p.saldo > 0 ? 'neg' : ''}`}>{cop(p.saldo)}</td>
                <td><Chip>{p.alerta}</Chip></td>
              </tr>))}
            </tbody>
          </table></div>
        )}
      </section>
    </>
  );
}
