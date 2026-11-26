import 'server-only';
import crypto from 'node:crypto';
import { cache } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { sql } from './db';
import { mesActual } from './fechas';
import { puede } from './permisos';

const COOKIE = 'g18_sesion';
const DURACION_MS = 12 * 60 * 60 * 1000; // 12 horas

function secreto() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('Falta SESSION_SECRET en .env.local');
  return s;
}
const firma = datos => crypto.createHmac('sha256', secreto()).update(datos).digest('base64url');

export async function crearSesion(userId) {
  const datos = Buffer.from(JSON.stringify({ u: userId, e: Date.now() + DURACION_MS })).toString('base64url');
  (await cookies()).set(COOKIE, `${datos}.${firma(datos)}`, {
    httpOnly: true, sameSite: 'lax', path: '/', maxAge: DURACION_MS / 1000, secure: process.env.NODE_ENV === 'production',
  });
}

export async function borrarSesion() {
  const c = await cookies();
  c.delete(COOKIE);
  c.delete('empresa');
}

function leerToken(token) {
  const [datos, f] = String(token ?? '').split('.');
  if (!datos || !f) return null;
  const esperada = firma(datos);
  if (f.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(f), Buffer.from(esperada))) return null;
  try {
    const p = JSON.parse(Buffer.from(datos, 'base64url').toString());
    return p.e > Date.now() ? p.u : null;
  } catch { return null; }
}

// Usuario de la sesión con sus empresas (solo membresías activas). Una vez por petición.
export const usuarioActual = cache(async () => {
  const id = leerToken((await cookies()).get(COOKIE)?.value);
  if (!id) return null;
  const filas = await sql(`
    select u.id, u.email, u.debe_cambiar_clave, m.nombre, m.rol, m.permisos, e.id empresa_id, e.nombre empresa_nombre
    from usuarios u join miembros m on m.user_id = u.id and m.activo join empresas e on e.id = m.empresa_id
    where u.id = $1 order by e.nombre`, [id]);
  if (!filas.length) return null;
  return {
    id, email: filas[0].email, nombre: filas[0].nombre, debeCambiarClave: filas[0].debe_cambiar_clave,
    empresas: filas.map(f => ({ id: f.empresa_id, nombre: f.empresa_nombre, rol: f.rol, permisos: f.permisos ?? {} })),
  };
});

// Contexto de cada página: usuario, empresa activa, permisos y mes. Sin sesión → /login.
export async function contexto(searchParams) {
  const usuario = await usuarioActual();
  if (!usuario) redirect('/login');
  if (usuario.debeCambiarClave) redirect('/cambiar-clave');
  const elegida = (await cookies()).get('empresa')?.value;
  const m = usuario.empresas.find(e => e.id === elegida) ?? usuario.empresas[0];
  const sp = (await searchParams) ?? {};
  const mes = /^\d{4}-\d{2}$/.test(sp.mes ?? '') ? sp.mes : mesActual();
  return {
    usuario, empresas: usuario.empresas, empresa: { id: m.id, nombre: m.nombre }, rol: m.rol, permisos: m.permisos,
    puede: k => puede(m.rol, m.permisos, k), esAdmin: m.rol === 'admin',
    empresasCon: k => empresasCon(usuario, k),
    mes, mesInicio: `${mes}-01`, sp,
  };
}

// Pedidos y seguimiento de ventas son compartidos entre las empresas: cada persona ve
// los de todas las empresas donde tiene ese permiso (los ingresos y egresos sí van por empresa).
export function empresasCon(usuario, permiso) {
  return usuario.empresas.filter(e => puede(e.rol, e.permisos, permiso)).map(e => e.id);
}

// Para páginas: exige un permiso (o redirige a "sin permiso").
export async function requerir(searchParams, permiso) {
  const ctx = await contexto(searchParams);
  if (permiso && !ctx.puede(permiso)) redirect('/sin-permiso');
  return ctx;
}

// Para acciones del servidor: devuelve el contexto o lanza un error con mensaje claro.
export class SinPermiso extends Error {}
// empresaPantalla: la empresa que la persona tiene en pantalla al guardar (si abrió la app en dos ventanas
// y cambió de empresa en una, se guarda en la que está viendo, no en la última que eligió).
export async function contextoAccion(permiso, empresaPantalla = null) {
  const usuario = await usuarioActual();
  if (!usuario) throw new SinPermiso('Tu sesión terminó. Vuelve a iniciar sesión.');
  const elegida = (usuario.empresas.some(e => e.id === empresaPantalla) && empresaPantalla) || (await cookies()).get('empresa')?.value;
  const m = usuario.empresas.find(e => e.id === elegida) ?? usuario.empresas[0];
  if (permiso && !puede(m.rol, m.permisos, permiso)) throw new SinPermiso('No tienes permiso para hacer esto.');
  return { usuario, empresaId: m.id, rol: m.rol, permisos: m.permisos, esAdmin: m.rol === 'admin', puede: k => puede(m.rol, m.permisos, k),
    empresasCon: k => empresasCon(usuario, k) };
}
