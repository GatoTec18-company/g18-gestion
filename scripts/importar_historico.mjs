// Importa el histórico de las hojas a la base local, en UNA sola transacción.
// Si algún total no cuadra con la hoja, no se guarda nada.
//   node scripts/importar_historico.mjs importacion/libro_g18_2026-11.json importacion/sheets_g18_2026-11.json
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env.local'), 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const db = new pg.Client({ connectionString: env.DATABASE_URL });

const PROVEEDORES = ['Fernando', 'TM', 'Jaltech', 'MPS', 'Giftronic', 'Tecnosys', 'SED', 'Unitec', 'Amazon'];
// Igual que la "palabra clave" del CRONOGRAMA DE PAGOS. PSY* es la nómina de Yolman (así la cuenta la hoja).
const GASTO_FIJO_POR_PALABRA = [
  [/^PSY\b/, 'Nómina Yolman Contreras'],
  [/\bARRIENDO\b/, 'Arriendo'], [/\bLUZ\b/, 'Luz'], [/\bAGUA\b/, 'Agua'], [/\bINTERNET\b/, 'Internet'],
  [/\bSOFTWARE\b/, 'Software (prorrateado)'], [/\bCONTADOR\b/, 'Contador'], [/\bWAC\b/, 'Grupo WAC'],
  [/\bPAUTA\b/, 'Pauta'], [/\bSELLER\b/, 'Seller Chat'], [/\bMETA\b/, 'Meta Business'],
  [/\bVITRINA\b/, 'Vitrina comercial'], [/\bASEO\b/, 'Aseo'],
];
const ESTADO_PEDIDO = { 'POR PEDIR': 'por_pedir', 'PEDIDO': 'pedido', 'EN CAMINO': 'en_camino',
  'RECIBIDO EN TIENDA': 'recibido_en_tienda', 'ENTREGADO': 'entregado', 'CANCELADO': 'cancelado' };

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const uno = async (sql, params = []) => {
  const r = await q(sql, params);
  if (r.length !== 1) throw new Error(`Se esperaba 1 fila y hubo ${r.length}: ${sql} ${JSON.stringify(params)}`);
  return r[0];
};
const mapa = async (sql, params) => Object.fromEntries((await q(sql, params)).map(r => [r.k, r.id]));
const problemas = [];
const check = (nombre, real, esperado) => {
  const ok = Math.abs(Number(real) - Number(esperado)) < 0.01;
  console.log(`${ok ? '✓' : '✗'} ${nombre}: ${Number(real).toLocaleString('es-CO')} (hoja: ${Number(esperado).toLocaleString('es-CO')})`);
  if (!ok) problemas.push(nombre);
};

async function yaImportado(clave) {
  await q(`create table if not exists public._importaciones (clave text primary key, importado_en timestamptz not null default now())`);
  return (await q('select 1 from public._importaciones where clave = $1', [clave])).length > 0;
}

async function importarLibro(L, clave) {
  const emp = (await uno('select id from empresas where nombre = $1', [L.empresa])).id;
  const cuentas = await mapa('select nombre k, id from cuentas where empresa_id = $1', [emp]);
  const bolsillos = await mapa('select codigo k, id from bolsillos where empresa_id = $1', [emp]);
  const categorias = await mapa('select nombre k, id from categorias_gasto where empresa_id = $1', [emp]);
  const terceros = await mapa('select nombre k, id from terceros where empresa_id = $1 and es_proveedor', [emp]);
  const gastosFijos = await mapa('select concepto k, id from gastos_fijos where empresa_id = $1', [emp]);
  const ins = `insert into movimientos (empresa_id, fecha, tipo, clase, cuenta_id, monto, concepto, categoria_id,
               bolsillo_id, tercero_id, gasto_fijo_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`;

  for (const s of L.saldos_iniciales) {
    if (!s.monto) continue;
    await q(ins, [emp, L.mes, s.monto > 0 ? 'ingreso' : 'egreso', 'saldo_inicial', cuentas[s.cuenta],
      Math.abs(s.monto), `Saldo inicial bolsillo ${s.bolsillo}`, null, bolsillos[s.bolsillo], null, null]);
  }
  for (const v of L.ventas_dia) {
    await q(ins, [emp, v.fecha, 'ingreso', 'operacion', cuentas[v.cuenta], v.monto,
      `Ventas del día (${v.cuenta.toLowerCase()})`, null, null, null, null]);
  }
  const sinVinculo = [];
  // Correcciones confirmadas por el administrador (tienen prioridad sobre la hoja y las palabras clave)
  const corr = new Map((L.correcciones || []).map(c => [`${c.cuenta}:${c.fila}`, c]));
  for (const c of corr.values()) {
    const e = L.egresos.find(x => x.cuenta === c.cuenta && x.fila === c.fila);
    if (!e || e.concepto !== c.concepto) throw new Error(`La corrección de la fila ${c.fila} (${c.concepto}) no coincide con el libro`);
    if (c.crear_proveedor && !terceros[c.proveedor]) {
      terceros[c.proveedor] = (await uno(`insert into terceros (empresa_id, nombre, es_proveedor) values ($1,$2,true) returning id`,
        [emp, c.proveedor])).id;
      console.log(`  Proveedor creado: ${c.proveedor}`);
    }
  }
  for (const e0 of L.egresos) {
    const c = corr.get(`${e0.cuenta}:${e0.fila}`) || {};
    const e = { ...e0, categoria: c.categoria || e0.categoria };
    if (!categorias[e.categoria]) throw new Error(`Categoría desconocida "${e.categoria}" (fila ${e.fila})`);
    if (!bolsillos[e.bolsillo]) throw new Error(`Bolsillo desconocido "${e.bolsillo}" (fila ${e.fila})`);
    const C = e.concepto.toUpperCase();
    const prov = c.proveedor || PROVEEDORES.find(p => new RegExp(`\\b${p.toUpperCase()}\\b`).test(C));
    const gf = c.gasto_fijo || GASTO_FIJO_POR_PALABRA.find(([re]) => re.test(C))?.[1];
    if (c.proveedor && !terceros[c.proveedor]) throw new Error(`Proveedor desconocido ${c.proveedor}`);
    if (c.gasto_fijo && !gastosFijos[c.gasto_fijo]) throw new Error(`Gasto fijo desconocido ${c.gasto_fijo}`);
    if (e.categoria.startsWith('Proveedores') && !prov) sinVinculo.push(`${e.fecha} ${e.concepto} ${e.monto.toLocaleString('es-CO')}`);
    await q(ins, [emp, e.fecha, 'egreso', 'operacion', cuentas[e.cuenta], e.monto, e.concepto,
      categorias[e.categoria], bolsillos[e.bolsillo], prov ? terceros[prov] : null, gf ? gastosFijos[gf] : null]);
  }
  for (const h of L.control.historico) {
    await q(`insert into cierres_mes (empresa_id, mes, ventas, egresos, flujo_neto, saldo_real, compras_bolsillo_75,
             gastos_operativos, cartera_pendiente, proveedores_pendientes, detalle)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
      [emp, h.mes, h.ventas, h.egresos, h.flujo_neto, h.saldo_real, h.compras_bolsillo_75, h.gastos_operativos,
       h.cartera_pendiente, h.proveedores_pendientes, { fuente: 'HISTÓRICO de la hoja' }]);
  }

  // ---- cuadre contra la hoja ----
  console.log(`\nLibro diario ${L.mes.slice(0, 7)} · ${L.empresa}`);
  const r = await uno(`select * from v_resumen_mes where empresa_id = $1 and mes = $2`, [emp, L.mes]);
  check('Ventas efectivo', r.ventas_efectivo, L.control.ventas_efectivo);
  check('Ventas banco', r.ventas_banco, L.control.ventas_banco);
  check('Egresos', r.egresos, L.control.egresos);
  const sc = await mapa(`select nombre k, saldo id from v_saldos_cuenta where empresa_id = $1`, [emp]);
  check('Saldo final efectivo', sc.Efectivo, L.control.saldo_final_efectivo);
  check('Saldo final banco', sc.Bancos, L.control.saldo_final_banco);
  const sb = await q(`select codigo, medio, saldo from v_saldos_bolsillo where empresa_id = $1`, [emp]);
  for (const [cuenta, medio] of [['Efectivo', 'efectivo'], ['Bancos', 'banco']]) {
    for (const [cod, esperado] of Object.entries(L.control.bolsillos_final[cuenta])) {
      check(`Bolsillo ${cod} ${medio}`, sb.find(x => x.codigo === cod && x.medio === medio)?.saldo ?? 0, esperado);
    }
  }
  const fer = await uno(`select pagado from v_estado_proveedores where empresa_id = $1 and nombre = 'Fernando'`, [emp]);
  const conCorr = corr.size ? ' (con correcciones)' : '';
  check('Abonos a Fernando' + conCorr, fer.pagado, L.control.fernando_pagado ?? 3840000);
  const gfm = await mapa(`select concepto k, pagado id from gastos_fijos_mes($1, $2)`, [emp, L.mes]);
  check('Nómina Yolman (PSY)' + conCorr, gfm['Nómina Yolman Contreras'], L.control.nomina_yolman ?? 5313245);
  check('Arriendo pagado' + conCorr, gfm['Arriendo'], L.control.arriendo_pagado ?? 0);
  console.log(`  Correcciones aplicadas: ${corr.size}`);
  if (sinVinculo.length) {
    console.log(`\nPagos a proveedores sin proveedor reconocido (${sinVinculo.length}), igual que en la hoja:`);
    sinVinculo.forEach(s => console.log('  · ' + s));
  }
  await q('insert into public._importaciones (clave) values ($1)', [clave]);
}

async function importarSheets(S, clave) {
  const emp = (await uno('select id from empresas where nombre = $1', [S.empresa])).id;
  const entidades = await mapa('select nombre k, id from entidades_financiacion where empresa_id = $1', [emp]);

  const cliente = async ({ nombre, documento, telefono }) => {
    if (!nombre) return null;
    const ex = documento
      ? await q('select id from terceros where empresa_id = $1 and documento = $2', [emp, documento])
      : await q('select id from terceros where empresa_id = $1 and lower(nombre) = lower($2)', [emp, nombre]);
    if (ex.length) return ex[0].id;
    return (await uno(`insert into terceros (empresa_id, nombre, documento, telefono, es_cliente)
                       values ($1,$2,$3,$4,true) returning id`, [emp, nombre.trim(), documento || null, telefono || null])).id;
  };

  for (const p of S.pedidos) {
    const ped = await uno(`insert into pedidos (empresa_id, numero, fecha_pedido, fecha_estimada, cliente_id, estado,
                            observaciones, abonado_previo) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [emp, p.numero, p.fecha_pedido, p.fecha_estimada, await cliente({ nombre: p.cliente, telefono: p.telefono }),
       ESTADO_PEDIDO[p.estado], p.observaciones || null, p.abono || 0]);
    await q('insert into pedido_items (pedido_id, descripcion, precio_venta) values ($1,$2,$3)', [ped.id, p.producto, p.valor]);
  }
  const ultimo = Math.max(...S.pedidos.map(p => Number(p.numero.replace(/\D/g, ''))));
  await q(`insert into secuencias (empresa_id, tipo, ultimo) values ($1, 'pedido', $2)
           on conflict (empresa_id, tipo) do update set ultimo = greatest(secuencias.ultimo, excluded.ultimo)`, [emp, ultimo]);

  for (const v of S.ventas_financiadas) {
    let vend = await q('select id from empleados where empresa_id = $1 and nombre = $2', [emp, v.vendedor]);
    if (!vend.length) vend = await q('insert into empleados (empresa_id, nombre) values ($1,$2) returning id', [emp, v.vendedor]);
    const venta = await uno(`insert into ventas (empresa_id, fecha, numero_factura, vendedor_id, cliente_id, total)
                             values ($1,$2,$3,$4,$5,$6) returning id`,
      [emp, v.fecha, v.factura, vend[0].id, await cliente({ nombre: v.cliente, documento: v.documento }), v.valor]);
    const recibido = ['Aplicado en factura', 'Pagado por entidad'].includes(v.estado);
    if (!entidades[v.entidad]) throw new Error(`Entidad desconocida ${v.entidad}`);
    await q(`insert into venta_pagos (venta_id, forma, monto, entidad_id, detalle, fecha_estimada_pago,
             aplicado_en_factura, recibido_previo, fecha_recibido_previo) values ($1,'financiada',$2,$3,$4,$5,$6,$7,$8)`,
      [venta.id, v.valor, entidades[v.entidad], v.detalle, v.fecha_estimada, v.estado === 'Aplicado en factura',
       recibido ? v.valor : 0, v.fecha_pago_real]);
  }

  console.log(`\nPedidos y ventas financiadas · ${S.empresa}`);
  const p = await uno(`select count(*) n, sum(valor) valor, sum(abonado) abonado, sum(saldo) saldo,
                       count(*) filter (where alerta = 'FALTA VALOR') sin_valor from v_pedidos where empresa_id = $1`, [emp]);
  check('Pedidos', p.n, 11); check('Valor total pedidos', p.valor, 16583000);
  check('Total abonado', p.abonado, 14533000); check('Saldo por cobrar', p.saldo, 2050000);
  check('Pedidos sin valor', p.sin_valor, 2);  // la hoja cuenta 1: PED-008 tampoco tiene valor
  const c = await uno(`select count(*) n, sum(monto) vendido, sum(pendiente) pendiente from v_cuentas_por_cobrar where empresa_id = $1`, [emp]);
  check('Ventas financiadas', c.n, 5); check('Valor vendido', c.vendido, 5774800);
  check('Pendiente de pago por entidades', c.pendiente, 4090000);
  await q('insert into public._importaciones (clave) values ($1)', [clave]);
}

await db.connect();
try {
  await q('begin');
  for (const archivo of process.argv.slice(2)) {
    const clave = path.basename(archivo, '.json');
    if (await yaImportado(clave)) { console.log(`(${clave} ya estaba importado, se omite)`); continue; }
    const datos = JSON.parse(fs.readFileSync(path.resolve(archivo), 'utf8'));
    if (datos.egresos) await importarLibro(datos, clave); else await importarSheets(datos, clave);
  }
  if (problemas.length) throw new Error(`No cuadra: ${problemas.join(', ')}. No se guardó nada.`);
  await q('commit');
  console.log('\nImportación guardada.');
} catch (e) {
  await q('rollback');
  console.error('\nError:', e.message);
  process.exitCode = 1;
} finally { await db.end(); }
