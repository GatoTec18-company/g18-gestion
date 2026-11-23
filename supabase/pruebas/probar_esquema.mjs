process.on('uncaughtException', e=>{console.log('ERROR:', e.message, '|', e.where||'', '| pos', e.position||''); process.exit(1)});
import { PGlite } from '@electric-sql/pglite';
import fs from 'node:fs';
const dir = process.argv[2];
const db = new PGlite();
const q = async (sql, label) => { const r = await db.query(sql); if (label) { console.log('\n## ' + label); console.table(r.rows); } return r.rows; };
const expectErr = async (sql, label) => { try { await db.exec(sql); console.log('FALLO (no dio error): ' + label); } catch (e) { console.log('OK error esperado [' + label + ']: ' + e.message); } };
await db.exec(`
  create role authenticated; create role anon;
  create schema auth;
  create table auth.users (id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
  grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;
`);
for (const f of fs.readdirSync(dir).sort()) { await db.exec(fs.readFileSync(dir + '/' + f, 'utf8')); console.log('migración aplicada:', f); }
await db.exec(`grant usage on schema public to authenticated; grant select, insert, update, delete on all tables in schema public to authenticated; grant usage on all sequences in schema public to authenticated;`);

const G = "'00000000-0000-0000-0000-000000000018'", T = "'00000000-0000-0000-0000-000000000118'";
const id = (tabla, nombre, emp = G, col = 'nombre') => `(select id from ${tabla} where empresa_id=${emp} and ${col}='${nombre}')`;

// 1. venta de contado (empresa configurada para mover caja venta por venta)
await db.exec(`update empresas set ventas_mueven_caja = true where id = ${G}`);
await db.exec(`insert into ventas (id, empresa_id, fecha, numero_factura, total) values ('11111111-0000-0000-0000-000000000001', ${G}, '2026-11-09', 'FEG590', 1000000);
  insert into venta_pagos (venta_id, forma, monto, cuenta_id) values ('11111111-0000-0000-0000-000000000001','efectivo',1000000, ${id('cuentas','Efectivo')});`);
await q(`select b.codigo, mb.monto from movimiento_bolsillos mb join bolsillos b on b.id=mb.bolsillo_id join movimientos m on m.id=mb.movimiento_id where m.concepto='Venta FEG590' order by b.orden`, '1. Venta contado 1.000.000 → reparto en bolsillos');

// 2. ventas financiadas y fecha estimada
await db.exec(`
  insert into terceros (id, empresa_id, nombre, documento, es_cliente) values ('22222222-0000-0000-0000-000000000001', ${G}, 'GUTIERREZ JANNY', '1078688075', true);
  insert into ventas (id, empresa_id, fecha, numero_factura, cliente_id, total) values
   ('11111111-0000-0000-0000-000000000002', ${G}, '2026-11-07', 'FEG594', '22222222-0000-0000-0000-000000000001', 488000),
   ('11111111-0000-0000-0000-000000000003', ${G}, '2026-11-10', 'FEGS1', null, 500000),
   ('11111111-0000-0000-0000-000000000004', ${G}, '2026-11-26', 'FEGS2', null, 500000),
   ('11111111-0000-0000-0000-000000000005', ${G}, '2026-11-13', 'FEGT1', null, 321500),
   ('11111111-0000-0000-0000-000000000006', ${G}, '2026-11-13', 'FEG602', null, 1100000);
  insert into venta_pagos (venta_id, forma, monto, entidad_id, detalle) values
   ('11111111-0000-0000-0000-000000000002','financiada',488000, ${id('entidades_financiacion','Addi')}, 'MARKETPLACE'),
   ('11111111-0000-0000-0000-000000000003','financiada',500000, ${id('entidades_financiacion','Sumas Pay')}, null),
   ('11111111-0000-0000-0000-000000000004','financiada',500000, ${id('entidades_financiacion','Sumas Pay')}, null),
   ('11111111-0000-0000-0000-000000000005','financiada',321500, ${id('entidades_financiacion','Tarjeta de crédito')}, 'BANCO'),
   ('11111111-0000-0000-0000-000000000006','financiada',1100000, ${id('entidades_financiacion','Cooperativa')}, 'TIENDA FISICA');
  -- llega el pago de Addi
  insert into cobros (venta_pago_id, fecha, monto, cuenta_id)
   select vp.id, '2026-11-14', 488000, ${id('cuentas','Bancos')} from venta_pagos vp where vp.venta_id='11111111-0000-0000-0000-000000000002';
`);
await q(`select numero_factura, entidad, fecha_venta, fecha_estimada_pago, monto, recibido, pendiente, estado from v_cuentas_por_cobrar order by numero_factura`,
  '2. Ventas financiadas (esperado: Addi 14/11, Sumas 10/12 y 10/01, Tarjeta 17/11 por festivo 16/11, Cooperativa sin fecha)');

// 3. proveedor
await db.exec(`
  insert into facturas_proveedor (empresa_id, proveedor_id, numero, fecha, monto) values (${G}, ${id('terceros','Fernando')}, 'F-1', '2026-11-01', 5000000), (${G}, ${id('terceros','TM')}, 'T-9', '2026-11-02', 1200000);
  insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, categoria_id, bolsillo_id, tercero_id) values
   (${G}, '2026-11-08', 'egreso', ${id('cuentas','Bancos')}, 3000000, 'Pago abono Fernando', ${id('categorias_gasto','Proveedores (abonos y pagos)')}, ${id('bolsillos','10B',G,'codigo')}, ${id('terceros','Fernando')});`);
await q(`select nombre, cupo_credito, facturado, pagado, saldo, cupo_disponible from v_estado_proveedores where facturado>0 or pagado>0 order by nombre`, '3. Estado de cuenta proveedores');

// 4. pedido bajo encargo
await db.exec(`
  insert into terceros (id, empresa_id, nombre, telefono, es_cliente) values ('22222222-0000-0000-0000-000000000002', ${G}, 'angela maria solano', '3133868488', true);
  insert into pedidos (id, empresa_id, fecha_pedido, fecha_estimada, cliente_id, proveedor_id, estado) values
   ('33333333-0000-0000-0000-000000000001', ${G}, '2026-11-07', '2026-11-14', '22222222-0000-0000-0000-000000000002', ${id('terceros','Fernando')}, 'recibido_en_tienda'),
   ('33333333-0000-0000-0000-000000000002', ${G}, '2026-11-13', null, null, null, 'pedido');
  insert into pedido_items (pedido_id, descripcion, precio_venta) values
   ('33333333-0000-0000-0000-000000000001', 'Torre Compumax RTX 3050', 4100000),
   ('33333333-0000-0000-0000-000000000002', 'Ventilador Asus Vivobook X1504Z', null);
  insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, pedido_id, tercero_id) values
   (${G}, '2026-11-07', 'ingreso', ${id('cuentas','Efectivo')}, 2050000, 'Abono pedido torre', '33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000002');
  insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, categoria_id, bolsillo_id, pedido_id) values
   (${G}, '2026-11-09', 'egreso', ${id('cuentas','Efectivo')}, 1770000, 'Pago torre', ${id('categorias_gasto','Pedidos de clientes')}, ${id('bolsillos','75',G,'codigo')}, '33333333-0000-0000-0000-000000000001');`);
await q(`select numero, producto, valor, abonado, saldo, costo_pagado, utilidad, estado, alerta from v_pedidos order by numero`, '4. Pedidos bajo encargo (numeración automática PED-001, PED-002)');

// 5. gastos fijos
await db.exec(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, categoria_id, bolsillo_id, gasto_fijo_id) values
  (${G}, '2026-11-05', 'egreso', ${id('cuentas','Bancos')}, 830000, 'Arriendo abono', ${id('categorias_gasto','Arriendo y servicios')}, ${id('bolsillos','10A',G,'codigo')}, ${id('gastos_fijos','Arriendo',G,'concepto')});`);
await q(`select concepto, fecha_limite, previsto, pagado, diferencia, estado from gastos_fijos_mes(${G}, '2026-11-01') order by fecha_limite nulls last limit 6`, '5. Gastos fijos noviembre (Arriendo debe salir Parcial)');

// 6. traslado y saldos
await q(`select registrar_traslado(${G}, '2026-11-15', ${id('cuentas','Efectivo')}, ${id('cuentas','Bancos')}, ${id('bolsillos','75',G,'codigo')}, 500000, 'Consignación')`);
await q(`select nombre, saldo from v_saldos_cuenta where empresa_id=${G} and saldo<>0 order by nombre`, '6. Saldos por cuenta');
await q(`select codigo, medio, entradas, salidas, saldo from v_saldos_bolsillo where empresa_id=${G} order by medio, codigo`, '6b. Saldos por bolsillo y medio');
await q(`select mes, ventas_caja, ventas_efectivo, ventas_banco, egresos, flujo_neto, dias_con_ventas, gastos_sin_categoria from v_resumen_mes`, '6c. Resumen del mes');

// 7. reglas que deben fallar
await expectErr(`update venta_pagos set forma='financiada', entidad_id=${id('entidades_financiacion','Addi')} where venta_id='11111111-0000-0000-0000-000000000001'`, 'pasar contado a financiada');
await expectErr(`insert into movimientos (empresa_id, tipo, cuenta_id, monto, concepto) values (${G}, 'egreso', ${id('cuentas','Efectivo')}, 1000, 'egreso sin bolsillo')`, 'egreso sin bolsillo');
await db.exec(`insert into cierres_mes (empresa_id, mes, ventas, egresos, flujo_neto, saldo_real) values (${G}, '2026-11-01', 0,0,0,0)`);
await expectErr(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, bolsillo_id) values (${G}, '2026-11-20', 'egreso', ${id('cuentas','Efectivo')}, 1000, 'tarde', ${id('bolsillos','5',G,'codigo')})`, 'movimiento en mes cerrado');
await expectErr(`delete from movimientos where concepto='Pago torre'`, 'borrar en mes cerrado');

// 8. seguridad por empresa
await db.exec(`insert into auth.users values ('99999999-0000-0000-0000-000000000001');
  insert into miembros (user_id, empresa_id, nombre, rol) values ('99999999-0000-0000-0000-000000000001', ${G}, 'Colaborador G18', 'colaborador');
  insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto) values (${T}, '2026-12-01', 'ingreso', ${id('cuentas','Efectivo',T)}, 999, 'venta gatotec');`);
await db.exec(`set test.uid = '99999999-0000-0000-0000-000000000001'; set role authenticated;`);
await q(`select (select count(*) from empresas) empresas_visibles, (select count(*) from movimientos where empresa_id=${T}) movs_gatotec, (select count(*) from movimientos where empresa_id=${G}) movs_g18, (select count(*) from cuentas) cuentas_visibles`, '8. Colaborador de G18: no debe ver Gatotec');
await expectErr(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto) values (${T}, '2026-12-02', 'ingreso', ${id('cuentas','Efectivo',T)}, 5, 'intruso')`, 'colaborador G18 escribiendo en Gatotec');
const del = await db.query(`delete from terceros where nombre='Amazon' and empresa_id=${G} returning id`);
console.log('Colaborador borrando un tercero → filas borradas:', del.rows.length, '(esperado 0)');
await db.exec(`reset role;`);
await q(`select tabla, accion, count(*) from auditoria group by 1,2 order by 1,2`, '9. Auditoría');
