'use server';
import { transaccion } from '@/lib/db';
import { texto, correoValido } from '@/lib/entrada';
import { accion, exigir, empresaPermitida } from './comun';

export const guardarCliente = accion('clientes', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const nombre = texto(fd.get('nombre'));
  exigir(id, 'Cliente no encontrado.');
  exigir(nombre, 'Escribe el nombre del cliente.');
  const correo = texto(fd.get('correo'));
  exigir(!correo || correoValido(correo), 'El correo no es válido.');
  await transaccion(async q => {
    await empresaPermitida(q, 'terceros', id, ctx, 'clientes');
    await q(`update terceros set nombre = $2, documento = $3, telefono = $4, correo = $5, direccion = $6, notas = $7 where id = $1`,
      [id, nombre, texto(fd.get('documento')), texto(fd.get('telefono')), correo, texto(fd.get('direccion')), texto(fd.get('notas'))]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Cliente guardado.' };
});
