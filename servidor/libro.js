'use server';
import { transaccion } from '@/lib/db';
import { fechaValida, monto, texto } from '@/lib/entrada';
import { accion, exigir } from './comun';

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

export const crearMovimiento = accion('libro', async (ctx, fd) => {
  const tipo = fd.get('tipo') === 'ingreso' ? 'ingreso' : 'egreso';
  const valor = monto(fd.get('monto'));
  exigir(fechaValida(fd.get('fecha')), 'Falta la fecha.');
  exigir(texto(fd.get('cuenta_id')), 'Elige la cuenta.');
  exigir(valor > 0, 'El monto debe ser mayor que cero.');
  exigir(texto(fd.get('concepto')), 'Escribe el concepto.');
  if (tipo === 'egreso') {
    exigir(texto(fd.get('bolsillo_id')), 'Un egreso necesita bolsillo.');
    exigir(texto(fd.get('categoria_id')), 'Un egreso necesita categoría.');
  }
  await transaccion(q => q(`
    insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, categoria_id, bolsillo_id, tercero_id, gasto_fijo_id)
    select $1,$2,$3,c.id,$5,$6,$7,$8,$9,$10 from cuentas c where c.id = $4 and c.empresa_id = $1`,
  [ctx.empresaId, fd.get('fecha'), tipo, fd.get('cuenta_id'), valor, texto(fd.get('concepto')),
   tipo === 'egreso' ? texto(fd.get('categoria_id')) : null, texto(fd.get('bolsillo_id')), texto(fd.get('tercero_id')),
   tipo === 'egreso' ? texto(fd.get('gasto_fijo_id')) : null]), ctx.usuario.id);
  return { ok: true, mensaje: `${tipo === 'ingreso' ? 'Ingreso' : 'Egreso'} guardado.`, t: Date.now() };
});
