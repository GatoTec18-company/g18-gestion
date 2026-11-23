import Link from 'next/link';
import Comprobantes from '@/components/ui/Comprobantes';
import { notFound } from 'next/navigation';
import { sql, uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { cop, fecha } from '@/lib/formato';
import { Encabezado } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { anularMovimiento, editarMovimiento } from '@/servidor/libro';

export default async function EditarMovimiento({ params, searchParams }) {
  const { id } = await params;
  const ctx = await requerir(searchParams, 'libro');
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const e = ctx.empresa.id;
  const m = await uno(`select m.*, (select 1 from cierres_mes c where c.empresa_id = m.empresa_id and c.mes = date_trunc('month', m.fecha)::date) cerrado
                       from movimientos m where m.id = $1 and m.empresa_id = $2`, [id, e]);
  if (!m) notFound();
  const [cuentas, bolsillos, categorias, proveedores, gastosFijos, creditos, adjuntos, historial] = await Promise.all([
    sql(`select id, nombre from cuentas where empresa_id = $1 and (activa or id = $2) order by tipo, nombre`, [e, m.cuenta_id]),
    sql('select id, codigo, nombre from bolsillos where empresa_id = $1 order by orden', [e]),
    sql('select id, nombre from categorias_gasto where empresa_id = $1 and (activa or id = $2) order by nombre', [e, m.categoria_id]),
    sql('select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre', [e]),
    sql('select id, concepto from gastos_fijos where empresa_id = $1 order by concepto', [e]),
    sql(`select id, entidad || coalesce(' · ' || descripcion, '') nombre from creditos where empresa_id = $1 and (activo or id = $2) order by entidad`, [e, m.credito_id]),
    sql(`select id, nombre, tipo from comprobantes where movimiento_id = $1 order by creado_en`, [id]),
    sql(`select a.accion, a.fecha, coalesce(mi.nombre, 'sistema') quien from auditoria a
         left join lateral (select nombre from miembros where user_id = a.usuario limit 1) mi on true
         where a.tabla = 'movimientos' and a.registro_id = $1 order by a.fecha`, [id]),
  ]);
  const volver = `/libro?mes=${String(m.fecha).slice(0, 7)}`;
  const egreso = m.tipo === 'egreso';
  const bloqueado = m.cerrado || m.venta_pago_id || m.clase === 'prestamo';

  return (
    <>
      <Encabezado titulo={`Corregir ${egreso ? 'egreso' : 'ingreso'}`} sub={`${m.concepto} · ${cop(m.monto)} · ${fecha(m.fecha)}`}>
        <Link href={volver} className="btn-sec btn-link">Volver al libro</Link>
      </Encabezado>
      <section className="caja">
        <h2>Comprobantes <small>foto de la factura, transferencia o recibo</small></h2>
        <Comprobantes destino="movimiento" id={m.id} lista={adjuntos} />
      </section>
      {bloqueado ? (
        <section className="caja"><p>{m.cerrado ? 'Este movimiento es de un mes ya cerrado: no se puede cambiar. Si es necesario, el administrador debe reabrir el mes en Cierre de mes.'
          : m.clase === 'prestamo' ? <>Este movimiento es de un préstamo: se corrige o anula desde <Link href="/prestamos">Préstamos</Link>.</>
          : 'Este movimiento viene de una venta: se corrige desde la venta.'}</p></section>
      ) : (
        <div className="dos">
          <section className="caja">
            <h2>Datos</h2>
            <FormAccion action={editarMovimiento} boton="Guardar corrección" limpiar={false}>
              <input type="hidden" name="id" value={m.id} /><input type="hidden" name="tipo" value={m.tipo} />
              <label>Fecha<input type="date" name="fecha" defaultValue={m.fecha} required /></label>
              <label>Monto<input name="monto" inputMode="numeric" defaultValue={m.monto} required /></label>
              <label>Cuenta<select name="cuenta_id" defaultValue={m.cuenta_id}>{cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
              <label className="ancho">Motivo<input name="concepto" defaultValue={m.concepto} required /></label>
              <label>Bolsillo<select name="bolsillo_id" defaultValue={m.bolsillo_id ?? ''} required={egreso}>
                {!egreso && <option value="">Repartir 75/10/10/5</option>}
                {bolsillos.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select></label>
              {egreso && <>
                <label>Categoría<select name="categoria_id" defaultValue={m.categoria_id ?? ''} required>
                  <option value="" disabled>Elegir…</option>{categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
                <label>Proveedor<select name="tercero_id" defaultValue={m.tercero_id ?? ''}>
                  <option value="">—</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
                <label>Gasto fijo<select name="gasto_fijo_id" defaultValue={m.gasto_fijo_id ?? ''}>
                  <option value="">—</option>{gastosFijos.map(g => <option key={g.id} value={g.id}>{g.concepto}</option>)}</select></label>
                <label>Pago de crédito<select name="credito_id" defaultValue={m.credito_id ?? ''}>
                  <option value="">—</option>{creditos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
              </>}
            </FormAccion>
          </section>
          <section className="caja">
            <h2>Anular</h2>
            <p className="muted">Si este registro está repetido o fue un error, anúlalo: deja de contar en la caja y los bolsillos. Queda guardado en el historial quién lo anuló y cuándo.</p>
            <FormAccion action={anularMovimiento} boton="Anular este registro" className="mini" limpiar={false}
              confirmar={`¿Anular "${m.concepto}" por ${cop(m.monto)}? Esta acción no se puede deshacer desde la app.`}>
              <input type="hidden" name="id" value={m.id} />
            </FormAccion>
            <h3 className="subt">Historial</h3>
            {historial.length === 0 ? <p className="muted">Importado de la hoja, sin cambios.</p> : historial.map((h, i) => (
              <p key={i} className="muted" style={{ margin: '0 0 4px' }}>
                {h.accion === 'INSERT' ? 'Creado' : h.accion === 'UPDATE' ? 'Corregido' : 'Anulado'} por {h.quien} · {new Date(h.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}
              </p>))}
          </section>
        </div>
      )}
    </>
  );
}
