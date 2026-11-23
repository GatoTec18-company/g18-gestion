import 'server-only';
import { revalidatePath } from 'next/cache';
import { contextoAccion, SinPermiso } from '@/lib/sesion';
import { mensajeError } from '@/lib/entrada';

// Envuelve una acción: verifica sesión y permiso, captura errores y refresca las páginas.
// fn recibe (ctx, formData) y devuelve { ok, mensaje } o lanza un Error con mensaje para el usuario.
export function accion(permiso, fn) {
  return async (_prev, fd) => {
    let ctx;
    try {
      ctx = await contextoAccion(permiso);
    } catch (e) {
      if (e instanceof SinPermiso) return { ok: false, mensaje: e.message };
      throw e;
    }
    try {
      const r = await fn(ctx, fd);
      revalidatePath('/', 'layout');
      return r ?? { ok: true, mensaje: 'Guardado.' };
    } catch (e) {
      if (e?.digest?.startsWith?.('NEXT_REDIRECT')) throw e;   // dejar pasar redirect()
      if (e instanceof Aviso) return { ok: false, mensaje: e.message };
      return { ok: false, mensaje: mensajeError(e) };
    }
  };
}

// Error de validación con mensaje para mostrar tal cual
export class Aviso extends Error {}
export const exigir = (cond, mensaje) => { if (!cond) throw new Aviso(mensaje); };

// El registro debe pertenecer a la empresa activa
export async function deLaEmpresa(q, tabla, id, empresaId) {
  const r = await q(`select empresa_id from ${tabla} where id = $1`, [id]);
  exigir(r.length && r[0].empresa_id === empresaId, 'Registro no encontrado en esta empresa.');
}
