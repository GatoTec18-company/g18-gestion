import Link from 'next/link';
import Comprobantes from '@/components/ui/Comprobantes';
import Acciones from '@/components/ui/Acciones';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Chip, Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { anularFactura, crearFactura } from '@/servidor/proveedores';

const DESTINO = { mercancia: 'Mercancía para vender', pedido_cliente: 'Pedido de cliente', activos: 'Equipos / activos', saldo_inicial: 'Saldo que se debía', otro: 'Otro' };

export default async function Proveedores({ searchParams }) {
  const { empresa, sp } = await requerir(searchParams, 'proveedores');
  const e = empresa.id;
  const hoy = hoyCol();
  const [provs, facturas, pagos, sinProv, lista, adjuntos] = await Promise.all([
    sql(`select * from v_estado_proveedores where empresa_id = $1 and (facturado > 0 or pagado > 0 or cupo_credito > 0) order by saldo desc, nombre`, [e]),
    // Facturas con lo pendiente de cada una: los pagos se aplican a las más antiguas primero
    sql(`with f as (
           select f.*, sum(f.monto) over (partition by f.proveedor_id order by f.fecha, f.creado_en) acumulado
           from facturas_proveedor f where f.empresa_id = $1),
         p as (select tercero_id, sum(monto) pagado from movimientos where empresa_id = $1 and tipo = 'egreso' and tercero_id is not null group by 1)
         select f.id, f.numero, f.fecha, f.fecha_vencimiento, f.monto, f.destino, f.observaciones, t.nombre proveedor,
                greatest(0, least(f.monto, f.acumulado - coalesce(p.pagado, 0))) pendiente
         from f join terceros t on t.id = f.proveedor_id left join p on p.tercero_id = f.proveedor_id
         order by f.fecha desc, f.creado_en desc`, [e]),
    sql(`select m.id, m.fecha, m.concepto, m.monto, t.nombre proveedor, c.nombre cuenta from movimientos m
         join terceros t on t.id = m.tercero_id join cuentas c on c.id = m.cuenta_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and t.es_proveedor order by m.fecha desc limit 30`, [e]),
    sql(`select m.id, m.fecha, m.concepto, m.monto from movimientos m join categorias_gasto cg on cg.id = m.categoria_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and m.tercero_id is null and cg.tipo = 'proveedores'
         order by m.fecha desc`, [e]),
    sql(`select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre`, [e]),
    sql(`select c.id, c.nombre, c.tipo, c.factura_id from comprobantes c join facturas_proveedor f on f.id = c.factura_id where f.empresa_id = $1 order by c.creado_en`, [e]),
  ]);
  const estado = f => f.pendiente <= 0 ? 'Pagada' : f.fecha_vencimiento && f.fecha_vencimiento < hoy ? 'Vencida'
    : f.pendiente < f.monto ? 'Parcial' : 'Pendiente';
  const pendientes = facturas.filter(f => f.pendiente > 0);
  const deuda = provs.reduce((s, p) => s + Math.max(0, p.saldo), 0);
  const vencido = pendientes.filter(f => estado(f) === 'Vencida').reduce((s, f) => s + f.pendiente, 0);
  const verTodas = sp.ver === 'todas';

  return (
    <>
      <Encabezado titulo="Proveedores" sub={`${empresa.nombre} · lo que se debe, lo que se paga y el cupo`}>
        <Acciones excel="/api/exportar?tipo=proveedores" />
      </Encabezado>

      <section className="kpis">
        <div className="kpi"><div className="et">Deuda con proveedores</div><div className={`va ${deuda > 0 ? 'neg' : ''}`}>{cop(deuda)}</div>
          <div className="de">{pendientes.length} facturas pendientes</div></div>
        <div className="kpi"><div className="et">Vencido</div><div className={`va ${vencido > 0 ? 'neg' : ''}`}>{cop(vencido)}</div></div>
        <div className="kpi"><div className="et">Pagos sin proveedor</div><div className="va">{sinProv.length}</div>
          <div className="de">Asígnales proveedor para que descuenten la deuda</div></div>
      </section>

      <div className="dos">
        <section className="caja">
          <h2>Registrar compra a crédito</h2>
          <FormAccion action={crearFactura} boton="Registrar factura">
            <label>Proveedor<select name="proveedor_id" required defaultValue="">
              <option value="" disabled>Elegir…</option>{lista.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <label>N° de factura<input name="numero" /></label>
            <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
            <label>Vence<input type="date" name="fecha_vencimiento" /></label>
            <label>Valor<input name="monto" inputMode="numeric" required placeholder="0" /></label>
            <label>¿Para qué fue?<select name="destino" defaultValue="mercancia">
              {Object.entries(DESTINO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <label className="ancho">Observaciones<input name="observaciones" /></label>
          </FormAccion>
          <p className="muted">Los <b>pagos y abonos</b> se registran en el Libro diario como egreso, eligiendo el proveedor: se descuentan solos de lo que se debe, empezando por las facturas más antiguas.
            Para empezar, registra a cada proveedor lo que se le debía con “Saldo que se debía”.</p>
        </section>

        <section className="caja">
          <h2>Estado de cuenta por proveedor</h2>
          {provs.length === 0 ? <Vacio>Sin movimientos con proveedores.</Vacio> : (
            <div className="tabla-cont"><table className="tarjetas">
              <thead><tr><th>Proveedor</th><th className="n">Debe (compras)</th><th className="n">Pagado</th><th className="n">Saldo</th><th className="n">Cupo libre</th></tr></thead>
              <tbody>{provs.map(p => (
                <tr key={p.proveedor_id}>
                  <td className="t-tit"><b>{p.nombre}</b>{p.cupo_credito > 0 && <div className="muted">cupo {cop(p.cupo_credito)}</div>}</td>
                  <td className="n" data-label="Compras">{cop(p.facturado)}</td><td className="n" data-label="Pagado">{cop(p.pagado)}</td>
                  <td className={`n t-mon ${p.saldo > 0 ? 'neg' : ''}`}><b>{cop(p.saldo)}</b>{p.saldo < 0 && <div className="muted">pagado de más o falta registrar facturas</div>}</td>
                  <td className="n" data-label="Cupo libre">{p.cupo_credito > 0 ? cop(p.cupo_disponible) : '—'}</td>
                </tr>))}
              </tbody>
            </table></div>)}
        </section>
      </div>

      <section className="caja">
        <h2>Facturas de proveedores <small>{verTodas ? 'todas' : 'pendientes'}</small></h2>
        <div className="filtros">
          <Link href="/proveedores" className={!verTodas ? 'activo' : ''}>Pendientes ({pendientes.length})</Link>
          <Link href="/proveedores?ver=todas" className={verTodas ? 'activo' : ''}>Todas ({facturas.length})</Link>
        </div>
        {(verTodas ? facturas : pendientes).length === 0 ? <Vacio>No hay facturas {verTodas ? '' : 'pendientes'}.</Vacio> : (
          <div className="tabla-cont"><table className="tarjetas">
            <thead><tr><th>Fecha</th><th>Proveedor</th><th>Factura</th><th>Para</th><th>Vence</th><th className="n">Valor</th><th className="n">Pendiente</th><th>Estado</th><th /></tr></thead>
            <tbody>{(verTodas ? facturas : pendientes).map(f => (
              <tr key={f.id}>
                <td className="nw" data-label="📅">{fecha(f.fecha)}</td><td className="t-tit"><b>{f.proveedor}</b></td><td data-label="Factura">{f.numero ?? '—'}{f.observaciones && <div className="muted">{f.observaciones}</div>}</td>
                <td className="muted">{DESTINO[f.destino]}</td><td className="nw" data-label="Vence">{fecha(f.fecha_vencimiento)}</td>
                <td className="n t-mon">{cop(f.monto)}</td><td className="n" data-label="Debe">{cop(f.pendiente)}</td><td><Chip>{estado(f)}</Chip></td>
                <td className="t-acc"><Comprobantes destino="factura" id={f.id} lista={adjuntos.filter(x => x.factura_id === f.id)} compacto />
                  <FormAccion action={anularFactura} boton="Anular" className="mini" limpiar={false} confirmar={`¿Anular la factura de ${f.proveedor} por ${cop(f.monto)}?`}>
                  <input type="hidden" name="factura_id" value={f.id} /></FormAccion></td>
              </tr>))}
            </tbody>
          </table></div>)}
      </section>

      <div className="grilla">
        <section className="caja">
          <h2>Últimos pagos a proveedores</h2>
          {pagos.length === 0 ? <Vacio>Sin pagos.</Vacio> : (
            <div className="tabla-cont"><table className="tarjetas">
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Concepto</th><th className="n">Monto</th></tr></thead>
              <tbody>{pagos.map(p => (
                <tr key={p.id}><td data-label="📅">{fecha(p.fecha)}</td><td className="t-tit">{p.proveedor}</td><td className="t-linea">{p.concepto}<span className="muted"> · {p.cuenta}</span></td><td className="n t-mon">{cop(p.monto)}</td></tr>))}
              </tbody>
            </table></div>)}
        </section>
        <section className="caja">
          <h2>Pagos sin proveedor asignado <small>toca uno para asignarle proveedor</small></h2>
          {sinProv.length === 0 ? <Vacio>Todos los pagos tienen proveedor.</Vacio> : (
            <div className="tabla-cont"><table className="tarjetas">
              <thead><tr><th>Fecha</th><th>Concepto</th><th className="n">Monto</th></tr></thead>
              <tbody>{sinProv.map(p => (
                <tr key={p.id}><td data-label="📅">{fecha(p.fecha)}</td><td className="t-tit"><Link href={`/libro/movimiento/${p.id}`} className="link-editar">{p.concepto}</Link></td><td className="n t-mon">{cop(p.monto)}</td></tr>))}
              </tbody>
            </table></div>)}
        </section>
      </div>
    </>
  );
}
