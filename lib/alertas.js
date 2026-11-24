import 'server-only';
import { unstable_cache } from 'next/cache';
import { puede } from './permisos';
import { sql } from './db';
import { hoy } from './fechas';
import { cop, fecha } from './formato';

const DIAS_AVISO = 5; // avisar con estos días de anticipación
const diasEntre = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 864e5);
const cuando = d => d < 0 ? `venció hace ${-d} día${d === -1 ? '' : 's'}` : d === 0 ? 'vence hoy' : `vence en ${d} día${d === 1 ? '' : 's'}`;

// Lo que hay que atender: pagos que se vencen, plata que no ha llegado y pedidos atrasados.
// Cada alerta: { nivel: 'rojo' | 'ambar', icono, texto, detalle, href, orden }
export async function alertas(ctx) {
  const e = ctx.empresa.id, h = hoy(), mes = h.slice(0, 7);
  const out = [];
  const tareas = [];

  if (ctx.puede('proveedores')) tareas.push(sql(`
    with f as (select f.*, sum(f.monto) over (partition by f.proveedor_id order by f.fecha, f.creado_en) acumulado
               from facturas_proveedor f where f.empresa_id = $1),
         p as (select tercero_id, sum(monto) pagado from movimientos where empresa_id = $1 and tipo = 'egreso' and tercero_id is not null group by 1)
    select f.numero, f.fecha_vencimiento, t.nombre proveedor, greatest(0, least(f.monto, f.acumulado - coalesce(p.pagado, 0))) pendiente
    from f join terceros t on t.id = f.proveedor_id left join p on p.tercero_id = f.proveedor_id
    where f.fecha_vencimiento is not null and f.fecha_vencimiento <= $2::date + $3::int`, [e, h, DIAS_AVISO]).then(filas => {
    for (const f of filas.filter(x => x.pendiente > 0)) {
      const d = diasEntre(h, f.fecha_vencimiento);
      out.push({ nivel: d < 0 ? 'rojo' : 'ambar', icono: '🧾', orden: d, href: '/proveedores',
        texto: `Pagar a ${f.proveedor} ${cop(f.pendiente)}`, detalle: `Factura ${f.numero ?? 'sin número'} · ${cuando(d)} (${fecha(f.fecha_vencimiento)})` });
    }
  }));

  if (ctx.puede('creditos')) tareas.push(sql(`
    select c.entidad, c.descripcion, c.cuota, c.dia_pago, s.saldo,
      coalesce((select sum(monto) from movimientos m where m.credito_id = c.id and m.tipo = 'egreso' and to_char(m.fecha, 'YYYY-MM') = $2), 0) pagado_mes
    from creditos c join v_creditos s on s.id = c.id
    where c.empresa_id = $1 and c.activo and c.dia_pago is not null and s.saldo > 0`, [e, mes]).then(filas => {
    for (const c of filas) {
      if (c.cuota && c.pagado_mes >= c.cuota) continue;
      if (!c.cuota && c.pagado_mes > 0) continue;
      const ultimo = new Date(Date.UTC(+mes.slice(0, 4), +mes.slice(5, 7), 0)).getUTCDate();
      const vence = `${mes}-${String(Math.min(c.dia_pago, ultimo)).padStart(2, '0')}`;
      const d = diasEntre(h, vence);
      if (d > DIAS_AVISO) continue;
      out.push({ nivel: d < 0 ? 'rojo' : 'ambar', icono: '🏦', orden: d, href: '/creditos',
        texto: `Cuota de ${c.entidad}${c.descripcion ? ` (${c.descripcion})` : ''}${c.cuota ? ` ${cop(c.cuota - c.pagado_mes)}` : ''}`,
        detalle: `Día de pago ${c.dia_pago} · ${cuando(d)}` });
    }
  }));

  if (ctx.puede('gastos_fijos')) tareas.push(sql(`select * from gastos_fijos_mes($1, $2) where estado <> 'Pagado' and fecha_limite is not null`, [e, `${mes}-01`]).then(filas => {
    for (const g of filas) {
      const d = diasEntre(h, g.fecha_limite);
      if (d > DIAS_AVISO) continue;
      out.push({ nivel: d < 0 ? 'rojo' : 'ambar', icono: '📌', orden: d, href: '/gastos-fijos',
        texto: `${g.concepto} ${cop(g.diferencia)}`, detalle: `Gasto fijo${g.estado === 'Parcial' ? ' (pagado en parte)' : ''} · ${cuando(d)}` });
    }
  }));

  if (ctx.puede('libro')) tareas.push(sql(`select persona, concepto, saldo, fecha_esperada from v_por_cobrar
      where empresa_id = $1 and saldo > 0 and fecha_esperada is not null and fecha_esperada <= $2::date + $3::int`, [e, h, DIAS_AVISO]).then(filas => {
    for (const d of filas) {
      const dd = diasEntre(h, d.fecha_esperada);
      out.push({ nivel: dd < 0 ? 'rojo' : 'ambar', icono: '🤝', orden: dd, href: '/prestamos',
        texto: `${d.persona} debe ${cop(d.saldo)}`, detalle: `${d.concepto} · ${dd < 0 ? `debía pagar hace ${-dd} día${dd === -1 ? '' : 's'}` : dd === 0 ? 'paga hoy' : `paga en ${dd} día${dd === 1 ? '' : 's'}`}` });
    }
  }));

  const conPedidos = ctx.empresasCon('pedidos');
  if (conPedidos.length) tareas.push(sql(`select id, numero, producto, cliente, fecha_estimada, alerta from v_pedidos
      where empresa_id = any($1) and alerta in ('ATRASADO', 'ENTREGA PRÓXIMA')`, [conPedidos]).then(filas => {
    for (const p of filas) {
      const d = diasEntre(h, p.fecha_estimada);
      out.push({ nivel: p.alerta === 'ATRASADO' ? 'rojo' : 'ambar', icono: '📦', orden: d, href: `/pedidos/${p.id}`,
        texto: `Pedido ${p.numero}: ${p.producto ?? 'sin producto'}${p.cliente ? ` · ${p.cliente}` : ''}`,
        detalle: p.alerta === 'ATRASADO' ? `Atrasado: se prometió para el ${fecha(p.fecha_estimada)}` : `Se entrega el ${fecha(p.fecha_estimada)}` });
    }
  }));

  const conCartera = ctx.empresasCon('cartera');
  if (conCartera.length) tareas.push(sql(`select entidad, cliente, pendiente, fecha_estimada_pago, estado, etapa from v_cuentas_por_cobrar
      where empresa_id = any($1) and etapa in ('esperando_pago', 'por_facturar') and estado in ('Vencido', 'Pagado: falta aplicar en factura')`, [conCartera]).then(filas => {
    const vencidas = filas.filter(v => v.estado === 'Vencido');
    for (const v of vencidas) {
      const d = diasEntre(h, v.fecha_estimada_pago);
      out.push({ nivel: 'rojo', icono: '💳', orden: d, href: '/cartera?etapa=esperando_pago',
        texto: `${v.entidad} no ha pagado ${cop(v.pendiente)}${v.cliente ? ` (${v.cliente})` : ''}`, detalle: `Debía llegar el ${fecha(v.fecha_estimada_pago)}` });
    }
    const sinAplicar = filas.length - vencidas.length;
    if (sinAplicar) out.push({ nivel: 'ambar', icono: '🧾', orden: 50, href: '/cartera?etapa=por_facturar',
      texto: `${sinAplicar} venta${sinAplicar === 1 ? '' : 's'} pagada${sinAplicar === 1 ? '' : 's'} sin aplicar en factura`, detalle: 'Ya llegó la plata: falta aplicarla en la factura' });
  }));

  const conRevision = ctx.empresasCon('revision');
  if (conRevision.length) tareas.push(sql(`select count(*)::int n from ventas where empresa_id = any($1) and revision = 'pendiente'`, [conRevision]).then(([r]) => {
    if (r.n) out.push({ nivel: 'ambar', icono: '🔎', orden: 40, href: '/cartera?etapa=por_confirmar',
      texto: `${r.n} venta${r.n === 1 ? '' : 's'} por confirmar en la plataforma`, detalle: 'Revisa que aparezcan en Addi, Sumas Pay, etc.' });
  }));

  await Promise.all(tareas);
  return out.sort((a, b) => (a.nivel === b.nivel ? 0 : a.nivel === 'rojo' ? -1 : 1) || a.orden - b.orden);
}

// Las alertas se calculan como máximo una vez por minuto por persona y empresa (se usan en el menú de cada página).
// Cualquier cambio que se guarde las vuelve a calcular (revalidateTag('alertas') en servidor/comun.js).
const enCache = unstable_cache(async desc => {
  const conPermiso = k => desc.empresas.filter(x => puede(x.rol, x.permisos, k)).map(x => x.id);
  return alertas({ empresa: { id: desc.empresa }, puede: k => puede(desc.rol, desc.permisos, k), empresasCon: conPermiso });
}, ['alertas-v1'], { revalidate: 60, tags: ['alertas'] });

export function alertasRapidas(ctx) {
  return enCache({ usuario: ctx.usuario.id, empresa: ctx.empresa.id, rol: ctx.rol, permisos: ctx.permisos,
    empresas: ctx.empresas.map(x => ({ id: x.id, rol: x.rol, permisos: x.permisos })) });
}
