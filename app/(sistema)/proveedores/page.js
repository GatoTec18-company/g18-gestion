import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';

export default async function Proveedores({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'proveedores');
  const e = empresa.id;
  const [provs, pagos, sinProv] = await Promise.all([
    sql(`select * from v_estado_proveedores where empresa_id = $1 order by pagado desc, nombre`, [e]),
    sql(`select m.fecha, m.concepto, m.monto, t.nombre proveedor, c.nombre cuenta from movimientos m
         join terceros t on t.id = m.tercero_id join cuentas c on c.id = m.cuenta_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and t.es_proveedor order by m.fecha desc limit 30`, [e]),
    sql(`select m.fecha, m.concepto, m.monto from movimientos m join categorias_gasto cg on cg.id = m.categoria_id
         where m.empresa_id = $1 and m.tipo = 'egreso' and m.tercero_id is null and cg.tipo = 'proveedores'
         order by m.fecha desc`, [e]),
  ]);

  return (
    <>
      <Encabezado titulo="Proveedores" sub={`${empresa.nombre} · estado de cuenta y cupo`} />
      <section className="caja">
        <h2>Estado de cuenta</h2>
        <div className="tabla-cont"><table>
          <thead><tr><th>Proveedor</th><th className="n">Cupo de crédito</th><th className="n">Facturado</th><th className="n">Pagado</th>
            <th className="n">Saldo</th><th className="n">Cupo disponible</th></tr></thead>
          <tbody>{provs.map(p => (
            <tr key={p.proveedor_id}>
              <td><b>{p.nombre}</b></td>
              <td className="n">{p.cupo_credito === null ? <span className="muted">sin dato</span> : cop(p.cupo_credito)}</td>
              <td className="n">{cop(p.facturado)}</td><td className="n">{cop(p.pagado)}</td>
              <td className={`n ${p.saldo > 0 ? 'neg' : ''}`}>{cop(p.saldo)}</td>
              <td className="n">{p.cupo_disponible === null ? '—' : cop(p.cupo_disponible)}</td>
            </tr>))}
          </tbody>
        </table></div>
        <p className="muted">Todavía no hay facturas de proveedores cargadas: por eso el saldo sale negativo (pagado de más). Al registrar las facturas a crédito, el saldo y el cupo quedan reales.</p>
      </section>

      <div className="grilla">
        <section className="caja">
          <h2>Últimos pagos a proveedores</h2>
          {pagos.length === 0 ? <Vacio>Sin pagos.</Vacio> : (
            <div className="tabla-cont"><table>
              <thead><tr><th>Fecha</th><th>Proveedor</th><th>Concepto</th><th className="n">Monto</th></tr></thead>
              <tbody>{pagos.map((p, i) => (
                <tr key={i}><td>{fecha(p.fecha)}</td><td>{p.proveedor}</td><td>{p.concepto}<div className="muted">{p.cuenta}</div></td><td className="n">{cop(p.monto)}</td></tr>))}
              </tbody>
            </table></div>)}
        </section>
        <section className="caja">
          <h2>Pagos sin proveedor asignado <small>{sinProv.length}</small></h2>
          {sinProv.length === 0 ? <Vacio>Todos los pagos tienen proveedor.</Vacio> : (
            <div className="tabla-cont"><table>
              <thead><tr><th>Fecha</th><th>Concepto</th><th className="n">Monto</th></tr></thead>
              <tbody>{sinProv.map((p, i) => (
                <tr key={i}><td>{fecha(p.fecha)}</td><td>{p.concepto}</td><td className="n">{cop(p.monto)}</td></tr>))}
              </tbody>
            </table></div>)}
        </section>
      </div>
    </>
  );
}
