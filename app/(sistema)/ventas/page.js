import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy } from '@/lib/fechas';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Encabezado, SelectorMes, Vacio } from '@/components/ui/Comunes';
import FormVenta from '@/components/formularios/FormVenta';

const FORMA = { efectivo: 'Efectivo', transferencia: 'Transferencia', tarjeta_debito: 'Tarjeta débito', financiada: 'Financiada', credito_directo: 'Crédito tienda' };
const ETAPA = { por_confirmar: 'Por confirmar', esperando_pago: 'Esperando pago', por_facturar: 'Por aplicar en factura', cerrada: 'Cerrada', rechazada: 'Rechazada' };
const TONO = { por_confirmar: 'ambar', esperando_pago: 'azul', por_facturar: 'ambar', cerrada: 'verde', rechazada: 'rojo' };

export default async function Ventas({ searchParams }) {
  const ctx = await requerir(searchParams);
  const registra = ctx.puede('ventas_registrar');
  const verTodas = ctx.puede('ventas_ver_todas');
  if (!registra && !verTodas) redirect('/sin-permiso');
  const { empresa, mes, mesInicio } = ctx;
  const e = empresa.id;
  // Compartido entre empresas: se ven las ventas de todas donde la persona tiene permiso
  const ids = [...new Set([...ctx.empresasCon('ventas_registrar'), ...ctx.empresasCon('ventas_ver_todas')])];
  const idsRegistra = ctx.empresasCon('ventas_registrar');
  const empresasRegistra = ctx.empresas.filter(x => idsRegistra.includes(x.id));
  const nombreEmpresa = Object.fromEntries(ctx.empresas.map(x => [x.id, x.nombre]));
  const varias = ids.length > 1;
  const [ventas, entidades, vendedores, clientes] = await Promise.all([
    sql(`select v.id, v.empresa_id, v.fecha, v.numero_factura, v.total, v.producto, v.revision, v.nota_revision,
           t.nombre cliente, t.documento, em.nombre vendedor, coalesce(mr.nombre, '—') registro,
           (select max(c.etapa) from v_cuentas_por_cobrar c where c.venta_id = v.id) etapa,
           json_agg(json_build_object('forma', vp.forma, 'monto', vp.monto, 'cuenta', c.nombre, 'entidad', ef.nombre, 'referencia', vp.referencia) order by vp.monto desc) pagos
         from ventas v left join terceros t on t.id = v.cliente_id left join empleados em on em.id = v.vendedor_id
         left join lateral (select nombre from miembros where user_id = v.registrado_por limit 1) mr on true
         join venta_pagos vp on vp.venta_id = v.id left join cuentas c on c.id = vp.cuenta_id
         left join entidades_financiacion ef on ef.id = vp.entidad_id
         where v.empresa_id = any($1) and date_trunc('month', v.fecha) = $2::date and ($3 or v.registrado_por = $4)
         group by v.id, t.nombre, t.documento, em.nombre, mr.nombre order by v.fecha desc, v.creado_en desc`,
      [ids, mesInicio, verTodas, ctx.usuario.id]),
    sql(`select distinct nombre from entidades_financiacion where empresa_id = any($1) and activa order by nombre`, [idsRegistra]),
    verTodas ? sql(`select distinct nombre from empleados where empresa_id = any($1) and activo order by nombre`, [ids]) : [],
    sql(`select id, nombre, documento, telefono from terceros where empresa_id = $1 and es_cliente order by nombre`, [e]),
  ]);
  const total = ventas.reduce((s, v) => s + v.total, 0);

  return (
    <>
      <Encabezado titulo="Ventas por confirmar" sub={`${varias ? 'Las dos empresas' : empresa.nombre} · ${nombreMes(mes)}${verTodas ? '' : ' · tus ventas'}`}>
        <SelectorMes mes={mes} ruta="/ventas" />
      </Encabezado>
      {registra && (
        <section className="caja">
          <h2>Registrar venta con Addi, Sumas Pay, cooperativa o tarjeta de crédito</h2>
          <FormVenta hoy={hoy()} entidades={entidades.map(x => x.nombre)} vendedores={vendedores.map(x => x.nombre)} clientes={clientes}
            empresas={empresasRegistra} empresaActual={e}
            eligeVendedor={verTodas} revisaSolo={ctx.puede('revision')} />
        </section>
      )}
      <section className="caja">
        <h2>{verTodas ? 'Ventas registradas' : 'Tus ventas'} <small>{ventas.length} · {cop(total)}</small></h2>
        {ventas.length === 0 ? <Vacio>No hay ventas por confirmar registradas en este mes.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Fecha</th>{varias && <th>Empresa</th>}<th>Factura</th><th>Producto</th><th>Cliente</th><th>Vendedor</th><th>Forma de pago</th><th className="n">Total</th><th>Estado</th></tr></thead>
            <tbody>{ventas.map(v => (
              <tr key={v.id}>
                <td className="nw">{fecha(v.fecha)}</td>
                {varias && <td className="muted nw">{nombreEmpresa[v.empresa_id]?.split(' ')[0]}</td>}
                <td>{v.numero_factura ?? <span className="muted">—</span>}</td>
                <td className="prod">{v.producto ?? <span className="muted">—</span>}</td>
                <td>{v.cliente ?? <span className="muted">Sin cliente</span>}{v.documento && <div className="muted">CC {v.documento}</div>}</td>
                <td>{v.vendedor ?? '—'}{verTodas && <div className="muted">registró: {v.registro}</div>}</td>
                <td>{v.pagos.map((p, i) => <div key={i}>{FORMA[p.forma]} {(p.entidad ?? p.cuenta) && <span className="muted">({p.entidad ?? p.cuenta})</span>}
                  {v.pagos.length > 1 && <> · {cop(p.monto)}</>}{p.referencia && <div className="muted">Ref. {p.referencia}</div>}</div>)}</td>
                <td className="n"><b>{cop(v.total)}</b></td>
                <td>{v.etapa ? <span className={`chip ${TONO[v.etapa]}`}>{ETAPA[v.etapa]}</span> : <span className="muted">—</span>}
                  {v.revision === 'rechazada' && v.nota_revision && <div className="muted">{v.nota_revision}</div>}</td>
              </tr>))}
            </tbody>
          </table></div>)}
        <p className="muted">Aquí van solo las ventas cuyo pago llega después. El efectivo y las transferencias del día se registran como total en el Libro diario.</p>
      </section>
    </>
  );
}
