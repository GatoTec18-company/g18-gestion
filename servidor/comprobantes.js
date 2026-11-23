'use server';
import { transaccion } from '@/lib/db';
import { texto } from '@/lib/entrada';
import { DESTINOS, destinoDeFila, guardarComprobante, puedeEnEmpresa } from '@/lib/comprobantes';
import { accion, exigir } from './comun';

const uuid = v => /^[0-9a-f-]{36}$/i.test(v ?? '');

export const subirComprobante = accion(null, async (ctx, fd) => {
  const destino = texto(fd.get('destino')), id = texto(fd.get('id'));
  exigir(DESTINOS[destino] && uuid(id), 'Registro no válido.');
  await transaccion(async q => {
    const [r] = await q(`select empresa_id from ${DESTINOS[destino].tabla} where id = $1`, [id]);
    exigir(r && puedeEnEmpresa(ctx, destino, r.empresa_id), 'No tienes permiso para adjuntar aquí.');
    const n = (await q(`select count(*)::int n from comprobantes where ${DESTINOS[destino].columna} = $1`, [id]))[0].n;
    exigir(n < 10, 'Ya hay 10 comprobantes en este registro.');
    exigir(await guardarComprobante(q, { empresaId: r.empresa_id, destino, registroId: id, archivo: fd.get('archivo') }), 'Elige una foto o un PDF.');
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Comprobante guardado.' };
});

export const borrarComprobante = accion(null, async (ctx, fd) => {
  const id = texto(fd.get('id'));
  exigir(uuid(id), 'Comprobante no válido.');
  await transaccion(async q => {
    const [c] = await q('select * from comprobantes where id = $1', [id]);
    exigir(c && puedeEnEmpresa(ctx, destinoDeFila(c), c.empresa_id), 'Comprobante no encontrado.');
    exigir(ctx.esAdmin || c.subido_por === ctx.usuario.id, 'Solo quien lo subió o un administrador puede quitarlo.');
    await q('delete from comprobantes where id = $1', [id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Comprobante quitado.' };
});
