'use server';
import { transaccion } from '@/lib/db';
import { fechaValida, monto, texto } from '@/lib/entrada';
import { hoy } from '@/lib/fechas';
import { cop } from '@/lib/formato';
import { accion, exigir } from './comun';

// Cuadre del día: se cuenta el efectivo y se compara con lo que dice el libro hasta ese día.
// Quien solo tiene permiso de cuadre no ve el resultado (conteo "a ciegas"); el administrador sí.
export const registrarCuadre = accion(null, async (ctx, fd) => {
  exigir(ctx.puede('cuadre') || ctx.puede('libro'), 'No tienes permiso para cuadrar la caja.');
  const f = String(fd.get('fecha') ?? '');
  const fecha = fechaValida(f) ? f : hoy();
  exigir(fecha <= hoy(), 'No se puede cuadrar un día que no ha llegado.');
  const contado = monto(fd.get('contado'));
  exigir(contado !== null, 'Escribe cuánto efectivo contaste.');
  let dif = 0;
  await transaccion(async q => {
    const [c] = await q(`select id from cuentas where empresa_id = $1 and tipo = 'efectivo' and activa order by nombre limit 1`, [ctx.empresaId]);
    exigir(c, 'La empresa no tiene una cuenta de efectivo activa.');
    const [l] = await q(`select coalesce(sum(case tipo when 'ingreso' then monto else -monto end), 0) v from movimientos where cuenta_id = $1 and fecha <= $2`, [c.id, fecha]);
    await q(`delete from cuadres_caja where empresa_id = $1 and cuenta_id = $2 and fecha = $3 and coalesce(nota, '') not like 'Cierre%'`, [ctx.empresaId, c.id, fecha]);
    await q(`insert into cuadres_caja (empresa_id, fecha, cuenta_id, saldo_libro, saldo_contado, nota) values ($1,$2,$3,$4,$5,$6)`,
      [ctx.empresaId, fecha, c.id, l.v, contado, texto(fd.get('nota'))]);
    dif = contado - l.v;
  }, ctx.usuario.id);
  if (!ctx.puede('libro')) return { ok: true, mensaje: 'Cuadre guardado. Gracias.' };
  return { ok: Math.abs(dif) < 1000, mensaje: Math.abs(dif) < 1000 ? 'Cuadre guardado: la caja cuadra ✓'
    : `Cuadre guardado. ${dif < 0 ? 'Faltan' : 'Sobran'} ${cop(Math.abs(dif))} frente al libro.` };
});
