import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { contexto } from '@/lib/sesion';
import { cop, fecha } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';

const TABLAS = {
  movimientos: 'Libro diario', ventas: 'Venta', venta_pagos: 'Pago de venta', cobros: 'Pago de entidad', pedidos: 'Pedido',
  pedido_items: 'Producto de pedido', pedido_abonos: 'Abono de pedido', facturas_proveedor: 'Factura de proveedor', terceros: 'Cliente / proveedor',
  gastos_fijos: 'Gasto fijo', cuadres_caja: 'Cuadre de caja', creditos: 'Crédito', credito_cargos: 'Cargo a crédito', cierres_mes: 'Cierre de mes',
};
const ACCION = { INSERT: ['Creó', 'pos'], UPDATE: ['Cambió', ''], DELETE: ['Anuló / borró', 'neg'] };
const CAMPOS = {
  monto: 'monto', fecha: 'fecha', concepto: 'motivo', estado: 'estado', total: 'valor', numero_factura: 'factura', producto: 'producto',
  fecha_estimada: 'entrega estimada', fecha_estimada_pago: 'pago estimado', cuenta_id: 'cuenta', bolsillo_id: 'bolsillo', categoria_id: 'categoría',
  tercero_id: 'proveedor', nombre: 'nombre', telefono: 'teléfono', documento: 'cédula', precio_venta: 'precio', cantidad: 'cantidad',
  revision: 'revisión', aplicado_en_factura: 'aplicada en factura', saldo_contado: 'contado', monto_previsto: 'previsto', cuota: 'cuota',
  observaciones: 'observaciones', descripcion: 'descripción', fecha_vencimiento: 'vence', saldo_inicial: 'saldo inicial',
};
const IGNORAR = new Set(['id', 'creado_en', 'actualizado_en', 'empresa_id', 'creado_por', 'registrado_por', 'hecho_por', 'diferencia']);
const POR_PAGINA = 100;

const valor = (k, v) => v === null || v === undefined || v === '' ? '—'
  : ['monto', 'total', 'precio_venta', 'saldo_contado', 'monto_previsto', 'cuota', 'saldo_inicial'].includes(k) ? cop(Number(v))
  : /fecha/.test(k) ? fecha(v) : typeof v === 'boolean' ? (v ? 'sí' : 'no') : /_id$/.test(k) ? 'otro' : String(v).slice(0, 60);

function resumen(d) {
  if (!d) return '';
  const partes = [d.numero && `N° ${d.numero}`, d.concepto, d.producto ?? d.descripcion, d.nombre, d.entidad, d.numero_factura && `factura ${d.numero_factura}`,
    d.fecha && fecha(d.fecha), (d.monto ?? d.total ?? d.saldo_contado) != null && cop(Number(d.monto ?? d.total ?? d.saldo_contado))];
  return partes.filter(Boolean).slice(0, 4).join(' · ');
}
function cambios(a, d) {
  if (!a || !d) return [];
  return Object.keys(d).filter(k => !IGNORAR.has(k) && JSON.stringify(a[k]) !== JSON.stringify(d[k]))
    .map(k => `${CAMPOS[k] ?? k.replace(/_/g, ' ')}: ${valor(k, a[k])} → ${valor(k, d[k])}`);
}

export default async function Historial({ searchParams }) {
  const ctx = await contexto(searchParams);
  if (!ctx.esAdmin) redirect('/sin-permiso');
  const sp = ctx.sp;
  const tabla = TABLAS[sp.tabla] ? sp.tabla : '';
  const quien = /^[0-9a-f-]{36}$/i.test(sp.quien ?? '') ? sp.quien : '';
  const pagina = Math.max(0, parseInt(sp.p ?? '0', 10) || 0);
  const [filas, personas] = await Promise.all([
    sql(`select a.id, a.tabla, a.accion, a.antes, a.despues, a.fecha, a.usuario, coalesce(m.nombre, 'Sistema / importación') quien
         from auditoria a left join lateral (select nombre from miembros where user_id = a.usuario limit 1) m on true
         where a.tabla <> 'auditoria'
           and coalesce(a.despues->>'empresa_id', a.antes->>'empresa_id', $1) = $1
           and ($2 = '' or a.tabla = $2) and ($3 = '' or a.usuario::text = $3)
         order by a.fecha desc, a.id desc limit ${POR_PAGINA + 1} offset ${pagina * POR_PAGINA}`, [ctx.empresa.id, tabla, quien]),
    sql(`select distinct on (user_id) user_id id, nombre from miembros where empresa_id = $1 order by user_id, nombre`, [ctx.empresa.id]),
  ]);
  const hayMas = filas.length > POR_PAGINA;
  const url = p => `/historial?${new URLSearchParams({ ...(tabla && { tabla }), ...(quien && { quien }), ...(p && { p: String(p) }) })}`;

  return (
    <>
      <Encabezado titulo="Historial de cambios" sub={`${ctx.empresa.nombre} · quién registró, cambió o anuló qué (solo lo ve el administrador)`} />
      <section className="caja">
        <form className="filtros no-imprimir" action="/historial">
          <select name="tabla" defaultValue={tabla}><option value="">Todo</option>{Object.entries(TABLAS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          <select name="quien" defaultValue={quien}><option value="">Todas las personas</option>{personas.map(u => <option key={u.id} value={u.id}>{u.nombre}</option>)}</select>
          <button className="btn-sec">Filtrar</button>
          {(tabla || quien) && <Link href="/historial">Quitar filtros</Link>}
        </form>
        {filas.length === 0 ? <Vacio>No hay cambios registrados con ese filtro.</Vacio> : (
          <div className="tabla-cont"><table className="tarjetas">
            <thead><tr><th>Cuándo</th><th>Quién</th><th>Qué hizo</th><th>Dónde</th><th>Detalle</th></tr></thead>
            <tbody>{filas.slice(0, POR_PAGINA).map(f => {
              const [verbo, tono] = ACCION[f.accion] ?? [f.accion, ''];
              const cb = f.accion === 'UPDATE' ? cambios(f.antes, f.despues) : [];
              return (
                <tr key={f.id}>
                  <td className="nw muted" data-label="🕒">{new Date(f.fecha).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="t-tit">{f.quien}</td>
                  <td className={`t-mon ${tono}`}>{verbo}</td>
                  <td data-label="En">{TABLAS[f.tabla] ?? f.tabla}</td>
                  <td className="t-linea">{resumen(f.despues ?? f.antes)}
                    {cb.length > 0 && <div className="muted">{cb.slice(0, 5).join(' · ')}</div>}</td>
                </tr>);
            })}</tbody>
          </table></div>)}
        <div className="fila-botones" style={{ marginTop: 12 }}>
          {pagina > 0 && <Link href={url(pagina - 1)} className="btn-sec btn-link">← Más recientes</Link>}
          {hayMas && <Link href={url(pagina + 1)} className="btn-sec btn-link">Más antiguos →</Link>}
        </div>
      </section>
    </>
  );
}
