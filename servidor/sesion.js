'use server';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { sql, transaccion, uno } from '@/lib/db';
import { borrarSesion, crearSesion, usuarioActual } from '@/lib/sesion';
import { inicioPara } from '@/lib/permisos';
import { texto, validarClave } from '@/lib/entrada';
import { cifrarClave, claveCorrecta } from '@/lib/claves';

const espera = ms => new Promise(r => setTimeout(r, ms));

export async function hayAdministrador() {
  return !!(await uno(`select 1 from miembros where rol = 'admin' and activo limit 1`));
}

const MAX_FALLOS = 5;      // intentos fallidos permitidos…
const VENTANA_MIN = 15;    // …en estos minutos, por correo

export async function iniciarSesion(_prev, fd) {
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const clave = String(fd.get('clave') ?? '');
  if (!email || !clave) return { ok: false, mensaje: 'Escribe tu correo y tu contraseña.' };
  const { fallos } = await uno(`select count(*)::int fallos from intentos_login
                                where lower(email) = $1 and not exito and fecha > now() - make_interval(mins => $2)`, [email, VENTANA_MIN]);
  if (fallos >= MAX_FALLOS) {
    await espera(600);
    return { ok: false, mensaje: `Demasiados intentos fallidos. Espera ${VENTANA_MIN} minutos o pide al administrador que te asigne una contraseña nueva.` };
  }
  const u = await uno(`select u.id, u.clave_hash, u.debe_cambiar_clave from usuarios u
                       where lower(u.email) = $1 and exists (select 1 from miembros m where m.user_id = u.id and m.activo)`, [email]);
  const ok = u && await claveCorrecta(clave, u.clave_hash);
  await sql('insert into intentos_login (email, exito) values ($1, $2)', [email, !!ok]);
  if (!ok) { await espera(600); return { ok: false, mensaje: 'Correo o contraseña incorrectos.' }; }
  await sql('update usuarios set ultimo_ingreso = now() where id = $1', [u.id]);
  await crearSesion(u.id);
  if (u.debe_cambiar_clave) redirect('/cambiar-clave');
  const m = await uno(`select rol, permisos from miembros where user_id = $1 and activo order by creado_en limit 1`, [u.id]);
  redirect(inicioPara(m.rol, m.permisos));
}

// Solo funciona mientras no exista ningún administrador (primer uso).
export async function crearPrimerAdmin(_prev, fd) {
  if (await hayAdministrador()) return { ok: false, mensaje: 'Ya existe un administrador. Inicia sesión.' };
  const nombre = texto(fd.get('nombre'));
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const clave = String(fd.get('clave') ?? '');
  const err = [!nombre && 'Escribe tu nombre.', !/^\S+@\S+\.\S+$/.test(email) && 'Escribe un correo válido.', validarClave(clave),
    clave !== fd.get('clave2') && 'Las contraseñas no coinciden.'].filter(Boolean);
  if (err.length) return { ok: false, mensaje: err.join(' ') };
  const id = await transaccion(async q => {
    const [u] = await q(`insert into usuarios (email, clave_hash, ultimo_ingreso) values ($1, $2, now()) returning id`, [email, await cifrarClave(clave)]);
    await q(`insert into miembros (user_id, empresa_id, nombre, rol) select $1, id, $2, 'admin' from empresas`, [u.id, nombre]);
    return u.id;
  });
  await crearSesion(id);
  redirect('/');
}

export async function cerrarSesion() {
  await borrarSesion();
  redirect('/login');
}

export async function cambiarClave(_prev, fd) {
  const u = await usuarioActual();
  if (!u) redirect('/login');
  const actual = String(fd.get('actual') ?? '');
  const nueva = String(fd.get('nueva') ?? '');
  const fila = await uno('select clave_hash from usuarios where id = $1', [u.id]);
  if (!(await claveCorrecta(actual, fila?.clave_hash))) return { ok: false, mensaje: 'La contraseña actual no es correcta.' };
  const err = [validarClave(nueva), nueva !== fd.get('nueva2') && 'Las contraseñas nuevas no coinciden.',
    nueva === actual && 'La nueva contraseña debe ser distinta.'].filter(Boolean);
  if (err.length) return { ok: false, mensaje: err.join(' ') };
  await sql('update usuarios set clave_hash = $2, debe_cambiar_clave = false where id = $1', [u.id, await cifrarClave(nueva)]);
  const m = u.empresas[0];
  redirect(inicioPara(m.rol, m.permisos));
}

export async function cambiarEmpresa(fd) {
  const u = await usuarioActual();
  const id = String(fd.get('empresa') ?? '');
  if (u?.empresas.some(e => e.id === id)) {
    (await cookies()).set('empresa', id, { path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax', httpOnly: true });
  }
  revalidatePath('/', 'layout');
}
