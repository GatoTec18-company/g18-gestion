import { sql } from '@/lib/db';
import { contextoAccion, SinPermiso } from '@/lib/sesion';
import { mesActual } from '@/lib/fechas';
import { flujoPorMes, GRUPOS } from '@/lib/reportes';
import { resumenMes } from '@/lib/resumenMes';
import { mesVecino } from '@/lib/formato';

export const dynamic = 'force-dynamic';

// Archivo CSV que Excel abre directo: separador ";" y tildes (UTF-8 con BOM)
function csv(secciones) {
  const celda = v => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return String(Math.round(v * 100) / 100).replace('.', ',');
    const s = String(v);
    return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + secciones.map(({ titulo, columnas, filas }) =>
    [titulo ? celda(titulo) : null, columnas.map(c => celda(c[0])).join(';'),
     ...filas.map(f => columnas.map(c => celda(typeof c[1] === 'function' ? c[1](f) : f[c[1]])).join(';'))]
      .filter(x => x !== null).join('\r\n')).join('\r\n\r\n');
}

const TIPOS = {
  async libro(ctx, mes) {
    const filas = await sql(`select m.fecha, m.tipo, m.clase, c.nombre cuenta, m.concepto, b.codigo bolsillo, cg.nombre categoria,
        t.nombre tercero, g.concepto gasto_fijo, cr.entidad credito, p.numero pedido, m.monto
      from movimientos m join cuentas c on c.id = m.cuenta_id left join bolsillos b on b.id = m.bolsillo_id
      left join categorias_gasto cg on cg.id = m.categoria_id left join terceros t on t.id = m.tercero_id
      left join gastos_fijos g on g.id = m.gasto_fijo_id left join creditos cr on cr.id = m.credito_id left join pedidos p on p.id = m.pedido_id
      where m.empresa_id = $1 and to_char(m.fecha, 'YYYY-MM') = $2 order by m.fecha, m.creado_en`, [ctx.empresaId, mes]);
    return { permiso: 'libro', nombre: `libro_diario_${mes}`, secciones: [{ columnas: [
      ['Fecha', 'fecha'], ['Tipo', 'tipo'], ['Clase', 'clase'], ['Cuenta', 'cuenta'], ['Concepto', 'concepto'], ['Bolsillo', 'bolsillo'],
      ['Categoría', 'categoria'], ['Proveedor/cliente', 'tercero'], ['Gasto fijo', 'gasto_fijo'], ['Crédito', 'credito'], ['Pedido', 'pedido'],
      ['Ingreso', f => f.tipo === 'ingreso' ? f.monto : null], ['Egreso', f => f.tipo === 'egreso' ? f.monto : null]], filas }] };
  },
  async reporte(ctx, mes) {
    const filas = await flujoPorMes(ctx.empresaId, mesVecino(mes, -5), mes);
    const conceptos = [['Ventas', f => f.ventas], ...GRUPOS.map(g => [g, f => f.porGrupo[g]]), ['Total egresos', f => f.egresos], ['Diferencia', f => f.flujo]];
    return { permiso: 'reportes', nombre: `a_donde_se_fue_la_plata_${mes}`, secciones: [{
      columnas: [['Concepto', 0], ...filas.map((f, i) => [f.mes, x => x[1](filas[i])])],
      filas: conceptos }] };
  },
  async proveedores(ctx) {
    const [saldos, facturas] = await Promise.all([
      sql(`select nombre, cupo_credito, facturado, pagado, saldo, cupo_disponible from v_estado_proveedores
           where empresa_id = $1 and (facturado > 0 or pagado > 0) order by saldo desc`, [ctx.empresaId]),
      sql(`select f.fecha, t.nombre proveedor, f.numero, f.destino, f.fecha_vencimiento, f.monto, f.observaciones
           from facturas_proveedor f join terceros t on t.id = f.proveedor_id where f.empresa_id = $1 order by f.fecha`, [ctx.empresaId]),
    ]);
    return { permiso: 'proveedores', nombre: 'proveedores', secciones: [
      { titulo: 'ESTADO DE CUENTA', columnas: [['Proveedor', 'nombre'], ['Cupo', 'cupo_credito'], ['Compras', 'facturado'], ['Pagado', 'pagado'], ['Saldo', 'saldo'], ['Cupo libre', 'cupo_disponible']], filas: saldos },
      { titulo: 'FACTURAS', columnas: [['Fecha', 'fecha'], ['Proveedor', 'proveedor'], ['Factura', 'numero'], ['Para', 'destino'], ['Vence', 'fecha_vencimiento'], ['Valor', 'monto'], ['Observaciones', 'observaciones']], filas: facturas },
    ] };
  },
  async creditos(ctx) {
    const filas = await sql(`select entidad, tipo, descripcion, saldo_inicial, fecha_inicial, cargos, pagado, saldo, cuota, dia_pago, activo
      from v_creditos where empresa_id = $1 order by activo desc, saldo desc`, [ctx.empresaId]);
    return { permiso: 'creditos', nombre: 'creditos_y_bancos', secciones: [{ columnas: [['Entidad', 'entidad'], ['Tipo', 'tipo'], ['Descripción', 'descripcion'],
      ['Debía', 'saldo_inicial'], ['A la fecha', 'fecha_inicial'], ['Aumentos', 'cargos'], ['Pagado', 'pagado'], ['Saldo', 'saldo'],
      ['Cuota', 'cuota'], ['Día de pago', 'dia_pago'], ['Activo', f => f.activo ? 'sí' : 'no']], filas }] };
  },
  async ventas(ctx) {
    const ids = [...new Set([...ctx.empresasCon('cartera'), ...ctx.empresasCon('revision')])];
    const filas = await sql(`select c.*, e.nombre empresa from v_cuentas_por_cobrar c join empresas e on e.id = c.empresa_id
      where c.empresa_id = any($1) order by c.fecha_venta`, [ids]);
    return { permiso: ids.length ? null : 'cartera', nombre: 'ventas_financiadas', secciones: [{ columnas: [['Empresa', 'empresa'], ['Fecha venta', 'fecha_venta'],
      ['Factura', 'numero_factura'], ['Entidad', 'entidad'], ['Producto', 'producto'], ['Cliente', 'cliente'], ['Cédula', 'documento'], ['Vendedor', 'vendedor'],
      ['Referencia', 'referencia'], ['Valor', 'monto'], ['Recibido', 'recibido'], ['Pendiente', 'pendiente'], ['Pago estimado', 'fecha_estimada_pago'],
      ['Pago real', 'fecha_pago_real'], ['Etapa', 'etapa'], ['Estado', 'estado']], filas }] };
  },
  async pedidos(ctx) {
    const filas = await sql(`select v.*, e.nombre empresa from v_pedidos v join empresas e on e.id = v.empresa_id
      where v.empresa_id = any($1) order by v.numero`, [ctx.empresasCon('pedidos')]);
    return { permiso: 'pedidos', nombre: 'pedidos_bajo_encargo', secciones: [{ columnas: [['N°', 'numero'], ['Empresa', 'empresa'], ['Fecha', 'fecha_pedido'],
      ['Producto', 'producto'], ['Cliente', 'cliente'], ['Teléfono', 'telefono'], ['Proveedor', 'proveedor'], ['Entrega estimada', 'fecha_estimada'],
      ['Entregado', 'fecha_entrega_real'], ['Estado', 'estado'], ['Valor', 'valor'], ['Abonado', 'abonado'], ['Saldo', 'saldo'], ['Alerta', 'alerta'],
      ['Observaciones', 'observaciones']], filas }] };
  },
  async clientes(ctx) {
    const filas = await sql(`select t.nombre, t.documento, t.telefono, t.correo, e.nombre empresa,
        (select count(*) from pedidos p where p.cliente_id = t.id) pedidos,
        (select count(*) from ventas v where v.cliente_id = t.id) ventas,
        (select coalesce(sum(total), 0) from ventas v where v.cliente_id = t.id and v.revision <> 'rechazada') total_ventas
      from terceros t join empresas e on e.id = t.empresa_id where t.es_cliente and t.empresa_id = any($1) order by t.nombre`, [ctx.empresasCon('clientes')]);
    return { permiso: 'clientes', nombre: 'clientes', secciones: [{ columnas: [['Cliente', 'nombre'], ['Cédula/NIT', 'documento'], ['Teléfono', 'telefono'],
      ['Correo', 'correo'], ['Empresa', 'empresa'], ['Pedidos', 'pedidos'], ['Ventas financiadas', 'ventas'], ['Total ventas', 'total_ventas']], filas }] };
  },
  async cierre(ctx, mes) {
    const r = await resumenMes(ctx.empresaId, `${mes}-01`);
    const kv = [['Ventas', r.ventas], ['  Efectivo', r.ventasEfectivo], ['  Cuentas', r.ventasBanco], ['Egresos', r.egresos], ['Flujo neto', r.flujo],
      ['Saldo efectivo', r.saldoEfectivo], ['Saldo banco', r.saldoBanco], ['Saldo real', r.saldoReal], ['Deuda proveedores', r.deudaProveedores],
      ['Deuda bancos', r.deudaBancos], ['Por cobrar a entidades', r.carteraPendiente]];
    return { permiso: 'cierre', nombre: `cierre_${mes}`, secciones: [
      { titulo: `CIERRE ${mes}`, columnas: [['Concepto', 0], ['Valor', 1]], filas: kv },
      { titulo: 'EGRESOS POR CATEGORÍA', columnas: [['Categoría', 'categoria'], ['Monto', 'monto']], filas: r.porCategoria },
      { titulo: 'BOLSILLOS', columnas: [['Bolsillo', 'codigo'], ['Nombre', 'nombre'], ['Medio', 'medio'], ['Saldo', 'saldo']], filas: r.bolsillos },
    ] };
  },
};

export async function GET(req) {
  const url = new URL(req.url);
  const tipo = url.searchParams.get('tipo');
  const mes = /^\d{4}-\d{2}$/.test(url.searchParams.get('mes') ?? '') ? url.searchParams.get('mes') : mesActual();
  if (!TIPOS[tipo]) return new Response('Tipo de exportación no válido', { status: 400 });
  let ctx;
  try { ctx = await contextoAccion(null); } catch (e) {
    if (e instanceof SinPermiso) return new Response(e.message, { status: 401 });
    throw e;
  }
  const r = await TIPOS[tipo](ctx, mes);
  if (r.permiso && !ctx.puede(r.permiso)) return new Response('No tienes permiso para descargar esto.', { status: 403 });
  return new Response(csv(r.secciones), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="g18_${r.nombre}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
