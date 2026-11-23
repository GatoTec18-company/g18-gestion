'use server';
import { transaccion } from '@/lib/db';
import { fechaValida, monto, texto } from '@/lib/entrada';
import { hoy } from '@/lib/fechas';
import { cop } from '@/lib/formato';
import { accion, deLaEmpresa, exigir } from './comun';

const fechaDe = fd => { const f = String(fd.get('fecha') ?? ''); return fechaValida(f) ? f : hoy(); };
const TIPOS = ['empleado', 'cliente', 'otro'];

async function nuevoMovimiento(q, { empresa, fecha, tipo, cuenta, bolsillo, monto: valor, concepto }) {
  await deLaEmpresa(q, 'cuentas', cuenta, empresa);
  if (bolsillo) await deLaEmpresa(q, 'bolsillos', bolsillo, empresa);
  const [m] = await q(`insert into movimientos (empresa_id, fecha, tipo, clase, cuenta_id, bolsillo_id, monto, concepto)
                       values ($1,$2,$3,'prestamo',$4,$5,$6,$7) returning id`, [empresa, fecha, tipo, cuenta, bolsillo || null, valor, concepto]);
  return m.id;
}

// ---------------- Entre las dos empresas ----------------
export const prestarEntreEmpresas = accion('libro', async (ctx, fd) => {
  const de = texto(fd.get('de_empresa')), a = texto(fd.get('a_empresa'));
  const permitidas = ctx.empresasCon('libro');
  exigir(de && a && de !== a, 'Elige de qué empresa sale y a cuál entra.');
  exigir(permitidas.includes(de) && permitidas.includes(a), 'Necesitas permiso de Libro diario en las dos empresas.');
  const valor = monto(fd.get('monto'));
  exigir(valor > 0, 'Escribe el monto.');
  const concepto = texto(fd.get('concepto')) ?? 'Préstamo entre empresas';
  const fecha = fechaDe(fd);
  exigir(texto(fd.get('bolsillo_sale')), 'Elige de qué bolsillo sale la plata.');
  await transaccion(async q => {
    const [n] = await q(`select (select nombre from empresas where id = $1) de, (select nombre from empresas where id = $2) a`, [de, a]);
    const de1 = async (tabla, id) => id ? (await q(`select empresa_id from ${tabla} where id = $1`, [id]))[0]?.empresa_id : null;
    exigir(await de1('cuentas', texto(fd.get('cuenta_sale'))) === de, `La cuenta de donde sale debe ser de ${n.de}.`);
    exigir(await de1('bolsillos', texto(fd.get('bolsillo_sale'))) === de, `El bolsillo de donde sale debe ser de ${n.de}.`);
    exigir(await de1('cuentas', texto(fd.get('cuenta_entra'))) === a, `La cuenta a donde entra debe ser de ${n.a}.`);
    const be = texto(fd.get('bolsillo_entra'));
    exigir(!be || await de1('bolsillos', be) === a, `El bolsillo a donde entra debe ser de ${n.a}.`);
    const [p] = await q(`insert into prestamos_empresas (fecha, de_empresa, a_empresa, monto, concepto) values ($1,$2,$3,$4,$5) returning id`,
      [fecha, de, a, valor, concepto]);
    const sale = await nuevoMovimiento(q, { empresa: de, fecha, tipo: 'egreso', cuenta: texto(fd.get('cuenta_sale')), bolsillo: texto(fd.get('bolsillo_sale')),
      monto: valor, concepto: `Plata enviada a ${n.a}: ${concepto}` });
    const entra = await nuevoMovimiento(q, { empresa: a, fecha, tipo: 'ingreso', cuenta: texto(fd.get('cuenta_entra')), bolsillo: texto(fd.get('bolsillo_entra')),
      monto: valor, concepto: `Plata recibida de ${n.de}: ${concepto}` });
    await q('update prestamos_empresas set mov_sale = $2, mov_entra = $3 where id = $1', [p.id, sale, entra]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Registrado en las dos empresas.' };
});

export const anularEntreEmpresas = accion('libro', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  await transaccion(async q => {
    const [p] = await q('select * from prestamos_empresas where id = $1', [id]);
    exigir(p, 'Registro no encontrado.');
    const permitidas = ctx.empresasCon('libro');
    exigir(permitidas.includes(p.de_empresa) && permitidas.includes(p.a_empresa), 'Necesitas permiso de Libro diario en las dos empresas.');
    await q('delete from prestamos_empresas where id = $1', [id]);
    await q('delete from movimientos where id = any($1)', [[p.mov_sale, p.mov_entra].filter(Boolean)]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Anulado en las dos empresas.' };
});

// ---------------- Lo que nos deben personas ----------------
export const crearPorCobrar = accion('libro', async (ctx, fd) => {
  const persona = texto(fd.get('persona')), concepto = texto(fd.get('concepto'));
  const valor = monto(fd.get('monto'));
  exigir(persona, 'Escribe quién debe.');
  exigir(concepto, 'Escribe por qué debe (ej. anticipo de sueldo).');
  exigir(valor > 0, 'Escribe el monto.');
  const tipo = TIPOS.includes(fd.get('tipo')) ? fd.get('tipo') : 'otro';
  const esperada = String(fd.get('fecha_esperada') ?? '');
  const fecha = fechaDe(fd);
  const saleCaja = fd.get('sale_caja') === 'on';
  if (saleCaja) exigir(texto(fd.get('bolsillo_id')), 'Elige de qué bolsillo sale la plata.');
  await transaccion(async q => {
    const mov = saleCaja ? await nuevoMovimiento(q, { empresa: ctx.empresaId, fecha, tipo: 'egreso', cuenta: texto(fd.get('cuenta_id')),
      bolsillo: texto(fd.get('bolsillo_id')), monto: valor, concepto: `Préstamo a ${persona}: ${concepto}` }) : null;
    await q(`insert into por_cobrar (empresa_id, persona, tipo, concepto, monto, fecha, fecha_esperada, movimiento_id) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.empresaId, persona, tipo, concepto, valor, fecha, fechaValida(esperada) ? esperada : null, mov]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: saleCaja ? 'Registrado. La salida de plata quedó en el libro.' : 'Registrado.' };
});

export const pagarPorCobrar = accion('libro', async (ctx, fd) => {
  const id = texto(fd.get('por_cobrar_id'));
  const valor = monto(fd.get('monto'));
  exigir(valor > 0, 'Escribe cuánto pagó.');
  const fecha = fechaDe(fd);
  const entraCaja = fd.get('entra_caja') === 'on';
  await transaccion(async q => {
    const [c] = await q('select * from v_por_cobrar where id = $1', [id]);
    exigir(c && c.empresa_id === ctx.empresaId, 'Registro no encontrado.');
    exigir(valor <= c.saldo + 0.5, `Solo debe ${cop(c.saldo)}. Revisa el monto.`);
    const mov = entraCaja ? await nuevoMovimiento(q, { empresa: ctx.empresaId, fecha, tipo: 'ingreso', cuenta: texto(fd.get('cuenta_id')),
      bolsillo: texto(fd.get('bolsillo_id')), monto: valor, concepto: `Pago de ${c.persona}: ${c.concepto}` }) : null;
    await q('insert into por_cobrar_pagos (por_cobrar_id, fecha, monto, nota, movimiento_id) values ($1,$2,$3,$4,$5)',
      [id, fecha, valor, texto(fd.get('nota')) ?? (entraCaja ? null : 'Sin entrada a la caja'), mov]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Pago registrado.' };
});

export const anularPorCobrar = accion('libro', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  await transaccion(async q => {
    const [c] = await q('select * from por_cobrar where id = $1', [id]);
    exigir(c && c.empresa_id === ctx.empresaId, 'Registro no encontrado.');
    const pagos = await q('select movimiento_id from por_cobrar_pagos where por_cobrar_id = $1 and movimiento_id is not null', [id]);
    await q('delete from por_cobrar where id = $1', [id]);
    await q('delete from movimientos where id = any($1)', [[c.movimiento_id, ...pagos.map(p => p.movimiento_id)].filter(Boolean)]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Anulado, con sus pagos.' };
});

export const anularPagoPorCobrar = accion('libro', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  await transaccion(async q => {
    const [p] = await q('select p.*, c.empresa_id from por_cobrar_pagos p join por_cobrar c on c.id = p.por_cobrar_id where p.id = $1', [id]);
    exigir(p && p.empresa_id === ctx.empresaId, 'Pago no encontrado.');
    await q('delete from por_cobrar_pagos where id = $1', [id]);
    if (p.movimiento_id) await q('delete from movimientos where id = $1', [p.movimiento_id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Pago anulado.' };
});
