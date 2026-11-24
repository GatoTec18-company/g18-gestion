import 'server-only';
import { sql, uno } from './db';
import { hoy } from './fechas';

const SEMANAS = 5;
const DIAS_PROMEDIO = 28;

const sumar = (f, n) => { const d = new Date(`${f}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const ultimoDia = (a, m) => new Date(Date.UTC(a, m, 0)).getUTCDate(); // m = 1..12
// Fechas de un pago mensual (día del mes) entre desde y hasta
function fechasMensuales(dia, desde, hasta) {
  const out = [];
  let [a, m] = desde.split('-').map(Number);
  for (let i = 0; i < 3; i++) {
    const f = `${a}-${String(m).padStart(2, '0')}-${String(Math.min(dia, ultimoDia(a, m))).padStart(2, '0')}`;
    if (f <= hasta) out.push(f);
    if (++m > 12) { m = 1; a++; }
  }
  return out;
}

// ¿Me alcanza la plata? Lo que entra y sale de una empresa en las próximas semanas.
// empresas: una o varias (para ver el negocio completo, las dos juntas)
export async function proyeccion(empresas) {
  const ids = [].concat(empresas);
  const h = hoy();
  const fin = sumar(h, SEMANAS * 7 - 1);
  const mesHoy = h.slice(0, 7);
  const [saldo, cxc, pedidos, facturas, creditos, gastosMes, gastos, promedio, deben] = await Promise.all([
    uno(`select coalesce(sum(case tipo when 'ingreso' then monto else -monto end), 0) v from movimientos where empresa_id = any($1) and fecha <= $2`, [ids, h]),
    sql(`select entidad, cliente, pendiente, fecha_estimada_pago f from v_cuentas_por_cobrar
         where empresa_id = any($1) and etapa = 'esperando_pago' and pendiente > 0`, [ids]),
    sql(`select id, numero, producto, cliente, saldo, fecha_estimada f from v_pedidos
         where empresa_id = any($1) and estado not in ('entregado', 'cancelado') and saldo > 0`, [ids]),
    sql(`with f as (select f.*, sum(f.monto) over (partition by f.proveedor_id order by f.fecha, f.creado_en) acumulado
                    from facturas_proveedor f where f.empresa_id = any($1)),
              p as (select tercero_id, sum(monto) pagado from movimientos where empresa_id = any($1) and tipo = 'egreso' and tercero_id is not null group by 1)
         select f.numero, f.fecha_vencimiento f, t.nombre proveedor, greatest(0, least(f.monto, f.acumulado - coalesce(p.pagado, 0))) pendiente
         from f join terceros t on t.id = f.proveedor_id left join p on p.tercero_id = f.proveedor_id`, [ids]),
    sql(`select c.id, c.entidad, c.descripcion, c.cuota, c.dia_pago, s.saldo,
           coalesce((select sum(monto) from movimientos m where m.credito_id = c.id and m.tipo = 'egreso' and to_char(m.fecha, 'YYYY-MM') = $2), 0) pagado_mes
         from creditos c join v_creditos s on s.id = c.id
         where c.empresa_id = any($1) and c.activo and c.dia_pago is not null and c.cuota > 0 and s.saldo > 0`, [ids, mesHoy]),
    sql(`select distinct on (g.gasto_fijo_id) g.gasto_fijo_id, g.diferencia, g.estado from unnest($1::uuid[]) e, gastos_fijos_mes(e, $2) g`, [ids, `${mesHoy}-01`]),
    sql(`select id, concepto, dia_pago, monto_previsto, compartido from gastos_fijos where (empresa_id = any($1) or compartido) and activo and dia_pago is not null and monto_previsto > 0`, [ids]),
    uno(`select coalesce(sum(monto), 0) / $3::numeric v from movimientos where empresa_id = any($1) and tipo = 'ingreso' and clase = 'operacion'
         and fecha > $2::date - $3::int and fecha <= $2::date`, [ids, h, DIAS_PROMEDIO]),
    sql(`select persona, concepto, saldo, fecha_esperada f from v_por_cobrar where empresa_id = any($1) and saldo > 0`, [ids]),
  ]);

  const entradas = [], salidas = [], sinFecha = [];
  const poner = (lista, x) => { if (!x.f) sinFecha.push({ ...x, lado: lista === entradas ? 'entra' : 'sale' }); else if (x.f <= fin) lista.push({ ...x, atrasado: x.f < h, f: x.f < h ? h : x.f, original: x.f }); };

  for (const v of cxc) poner(entradas, { tipo: 'Venta financiada', texto: `${v.entidad}${v.cliente ? ` · ${v.cliente}` : ''}`, monto: v.pendiente, f: v.f, href: '/cartera?etapa=esperando_pago' });
  for (const d of deben) poner(entradas, { tipo: 'Nos debe', texto: `${d.persona} · ${d.concepto}`, monto: d.saldo, f: d.f, href: '/prestamos' });
  for (const p of pedidos) poner(entradas, { tipo: 'Saldo de pedido', texto: `${p.numero} · ${p.producto ?? ''}${p.cliente ? ` · ${p.cliente}` : ''}`, monto: p.saldo, f: p.f, href: `/pedidos/${p.id}` });
  for (const f of facturas.filter(x => x.pendiente > 0)) poner(salidas, { tipo: 'Proveedor', texto: `${f.proveedor}${f.numero ? ` · factura ${f.numero}` : ''}`, monto: f.pendiente, f: f.f, href: '/proveedores' });
  for (const c of creditos) {
    let restante = c.saldo;
    for (const f of fechasMensuales(c.dia_pago, `${mesHoy}-01`, fin)) {
      let monto = c.cuota;
      if (f.slice(0, 7) === mesHoy) monto = Math.max(0, c.cuota - c.pagado_mes);
      monto = Math.min(monto, restante); restante -= monto;
      if (monto > 0) poner(salidas, { tipo: 'Cuota', texto: `${c.entidad}${c.descripcion ? ` · ${c.descripcion}` : ''}`, monto, f, href: '/creditos' });
    }
  }
  for (const g of gastos) {
    for (const f of fechasMensuales(g.dia_pago, `${mesHoy}-01`, fin)) {
      let monto = g.monto_previsto;
      if (f.slice(0, 7) === mesHoy) {
        const m = gastosMes.find(x => x.gasto_fijo_id === g.id);
        monto = m && m.estado !== 'Pagado' ? Math.max(0, m.diferencia) : 0;
      }
      if (monto > 0) poner(salidas, { tipo: g.compartido ? 'Gasto fijo compartido' : 'Gasto fijo', texto: g.concepto, monto, f, href: '/gastos-fijos' });
    }
  }

  const ventaDia = Math.round(promedio.v);
  let sinVentas = saldo.v, conVentas = saldo.v;
  const semanas = Array.from({ length: SEMANAS }, (_, i) => {
    const desde = sumar(h, i * 7), hasta = sumar(h, i * 7 + 6);
    const en = entradas.filter(x => x.f >= desde && x.f <= hasta).sort((a, b) => a.f.localeCompare(b.f));
    const sa = salidas.filter(x => x.f >= desde && x.f <= hasta).sort((a, b) => a.f.localeCompare(b.f));
    const entra = en.reduce((s, x) => s + x.monto, 0), sale = sa.reduce((s, x) => s + x.monto, 0);
    sinVentas += entra - sale; conVentas += entra - sale + ventaDia * 7;
    return { desde, hasta, entradas: en, salidas: sa, entra, sale, ventas: ventaDia * 7, saldoSinVentas: sinVentas, saldoConVentas: conVentas };
  });
  return { hoy: h, fin, saldoHoy: saldo.v, ventaDia, diasPromedio: DIAS_PROMEDIO, semanas, sinFecha,
    totalEntra: semanas.reduce((s, x) => s + x.entra, 0), totalSale: semanas.reduce((s, x) => s + x.sale, 0) };
}
