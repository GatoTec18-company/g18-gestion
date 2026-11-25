'use server';
import { redirect } from 'next/navigation';
import { revalidatePath, revalidateTag } from 'next/cache';
import { transaccion } from '@/lib/db';
import { fechaValida, monto, texto } from '@/lib/entrada';
import { guardarComprobante } from '@/lib/comprobantes';
import { accion, deLaEmpresa, exigir } from './comun';

// Ventas del día (como la fila del día en la hoja: una casilla de efectivo y una de cuentas).
// Guardar de nuevo el mismo día REEMPLAZA el valor; dejarlo en 0 lo borra. Se reparte en los bolsillos.
export const guardarVentasDia = accion('libro', async (ctx, fd) => {
  const fecha = texto(fd.get('fecha'));
  exigir(fechaValida(fecha), 'Elige el día.');
  const lineas = [
    { cuenta: texto(fd.get('cuenta_efectivo')), valor: monto(fd.get('efectivo')) ?? 0 },
    { cuenta: texto(fd.get('cuenta_banco')), valor: monto(fd.get('banco')) ?? 0 },
  ].filter(l => l.cuenta);
  exigir(lineas.every(l => l.valor >= 0), 'Los valores no pueden ser negativos.');
  const cambios = await transaccion(async q => {
    let n = 0;
    for (const l of lineas) {
      const [c] = await q('select id, nombre from cuentas where id = $1 and empresa_id = $2', [l.cuenta, ctx.empresaId]);
      exigir(c, 'Cuenta no válida.');
      const ex = await q(`select id, monto from movimientos where empresa_id = $1 and fecha = $2 and cuenta_id = $3
                            and tipo = 'ingreso' and clase = 'operacion' and concepto like 'Ventas del día%'`, [ctx.empresaId, fecha, c.id]);
      if (ex.length > 1) { // por si quedó repetido: se deja uno solo
        await q('delete from movimientos where id = any($1)', [ex.slice(1).map(x => x.id)]);
      }
      if (ex.length && l.valor > 0) {
        if (Number(ex[0].monto) !== l.valor) { await q('update movimientos set monto = $2 where id = $1', [ex[0].id, l.valor]); n++; }
      } else if (ex.length) {
        await q('delete from movimientos where id = $1', [ex[0].id]); n++;
      } else if (l.valor > 0) {
        await q(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto) values ($1,$2,'ingreso',$3,$4,$5)`,
          [ctx.empresaId, fecha, c.id, l.valor, `Ventas del día (${c.nombre.toLowerCase()})`]); n++;
      }
    }
    return n;
  }, ctx.usuario.id);
  return { ok: true, mensaje: cambios ? 'Ventas del día guardadas y repartidas en los bolsillos.' : 'No había cambios.', t: Date.now() };
});

// Datos de un egreso/ingreso tomados del formulario, validados contra la empresa activa
async function datosMovimiento(q, ctx, fd) {
  // "saldo_inicial": plata con la que arranca la caja; entra pero no cuenta como venta
  const clase = fd.get('tipo') === 'saldo_inicial' ? 'saldo_inicial' : 'operacion';
  const tipo = fd.get('tipo') === 'ingreso' || clase === 'saldo_inicial' ? 'ingreso' : 'egreso';
  const valor = monto(fd.get('monto'));
  exigir(fechaValida(fd.get('fecha')), 'Falta la fecha.');
  exigir(texto(fd.get('cuenta_id')), 'Elige la cuenta.');
  exigir(valor > 0, 'El monto debe ser mayor que cero.');
  exigir(texto(fd.get('concepto')), 'Escribe el motivo.');
  if (tipo === 'egreso') {
    exigir(texto(fd.get('bolsillo_id')), 'Un egreso necesita bolsillo.');
    exigir(texto(fd.get('categoria_id')), 'Un egreso necesita categoría.');
  }
  const d = {
    tipo, clase, monto: valor, fecha: fd.get('fecha'), concepto: texto(fd.get('concepto')),
    cuenta_id: texto(fd.get('cuenta_id')), bolsillo_id: texto(fd.get('bolsillo_id')),
    categoria_id: tipo === 'egreso' ? texto(fd.get('categoria_id')) : null,
    tercero_id: texto(fd.get('tercero_id')),
    gasto_fijo_id: tipo === 'egreso' ? texto(fd.get('gasto_fijo_id')) : null,
    credito_id: tipo === 'egreso' ? texto(fd.get('credito_id')) : null,
  };
  for (const [campo, tabla] of [['cuenta_id', 'cuentas'], ['bolsillo_id', 'bolsillos'], ['categoria_id', 'categorias_gasto'],
    ['tercero_id', 'terceros'], ['credito_id', 'creditos']]) {
    if (d[campo]) await deLaEmpresa(q, tabla, d[campo], ctx.empresaId);
  }
  // Los gastos fijos compartidos se pueden pagar desde cualquiera de las dos empresas
  if (d.gasto_fijo_id) {
    const [g] = await q('select empresa_id, compartido from gastos_fijos where id = $1', [d.gasto_fijo_id]);
    exigir(g && (g.empresa_id === ctx.empresaId || (g.compartido && ctx.usuario.empresas.some(x => x.id === g.empresa_id))), 'Gasto fijo no encontrado.');
  }
  return d;
}

export const crearMovimiento = accion('libro', async (ctx, fd) => {
  await transaccion(async q => {
    const d = await datosMovimiento(q, ctx, fd);
    const [m] = await q(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, categoria_id, bolsillo_id,
               tercero_id, gasto_fijo_id, credito_id, clase) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [ctx.empresaId, d.fecha, d.tipo, d.cuenta_id, d.monto, d.concepto, d.categoria_id, d.bolsillo_id,
       d.tercero_id, d.gasto_fijo_id, d.credito_id, d.clase]);
    await guardarComprobante(q, { empresaId: ctx.empresaId, destino: 'movimiento', registroId: m.id, archivo: fd.get('comprobante') });
  }, ctx.usuario.id);
  return { ok: true, mensaje: `${fd.get('tipo') === 'saldo_inicial' ? 'Saldo inicial' : fd.get('tipo') === 'ingreso' ? 'Ingreso' : 'Egreso'} guardado.`, t: Date.now() };
});

// Corregir un movimiento (queda el antes y el después en la auditoría). No se puede si el mes está cerrado.
export const editarMovimiento = accion('libro', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  await transaccion(async q => {
    const [m] = await q('select empresa_id, clase, venta_pago_id from movimientos where id = $1', [id]);
    exigir(m && m.empresa_id === ctx.empresaId, 'Movimiento no encontrado.');
    exigir(!m.venta_pago_id, 'Este movimiento viene de una venta: corrígelo desde la venta.');
    exigir(m.clase !== 'prestamo', 'Este movimiento es de un préstamo: se corrige desde Préstamos.');
    const d = await datosMovimiento(q, ctx, fd);
    await q(`update movimientos set fecha=$2, tipo=$3, cuenta_id=$4, monto=$5, concepto=$6, categoria_id=$7, bolsillo_id=$8,
               tercero_id=$9, gasto_fijo_id=$10, credito_id=$11 where id = $1`,
      [id, d.fecha, d.tipo, d.cuenta_id, d.monto, d.concepto, d.categoria_id, d.bolsillo_id, d.tercero_id, d.gasto_fijo_id, d.credito_id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Corregido.' };
});

// Anular = borrar el movimiento. Queda completo en la auditoría (quién, cuándo y qué era).
export const anularMovimiento = accion('libro', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  let mes;
  await transaccion(async q => {
    const [m] = await q(`select empresa_id, venta_pago_id, clase, to_char(fecha, 'YYYY-MM') mes from movimientos where id = $1`, [id]);
    mes = m?.mes;
    exigir(m && m.empresa_id === ctx.empresaId, 'Movimiento no encontrado.');
    exigir(!m.venta_pago_id, 'Este movimiento viene de una venta: anúlalo desde la venta.');
    exigir(m.clase !== 'prestamo', 'Este movimiento es de un préstamo: anúlalo desde Préstamos.');
    await q('update cobros set movimiento_id = null where movimiento_id = $1', [id]);
    await q('update pedido_abonos set movimiento_id = null where movimiento_id = $1', [id]);
    await q('delete from movimientos where id = $1', [id]);
  }, ctx.usuario.id);
  revalidatePath('/', 'layout');
  revalidateTag('alertas');
  redirect(`/libro?mes=${mes}&anulado=1`);
});
