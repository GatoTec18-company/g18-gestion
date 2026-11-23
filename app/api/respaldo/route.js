import { gzipSync } from 'node:zlib';
import { sql } from '@/lib/db';
import { usuarioActual } from '@/lib/sesion';
import { hoy } from '@/lib/fechas';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Copia completa de los datos (las dos empresas) en un archivo .json.gz.
// Solo para quien es administrador en todas sus empresas. No incluye contraseñas.
const OMITIR = new Set(['intentos_login']);
const SIN_COLUMNAS = { usuarios: ['clave_hash'] };

export async function GET() {
  const u = await usuarioActual();
  if (!u) return new Response('Inicia sesión.', { status: 401 });
  if (!u.empresas.length || u.empresas.some(e => e.rol !== 'admin')) return new Response('Solo el administrador puede descargar el respaldo.', { status: 403 });
  const tablas = await sql(`select table_name t from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE' order by 1`);
  const datos = { app: 'G18 Gestión', fecha: new Date().toISOString(), tablas: {} };
  for (const { t } of tablas) {
    if (OMITIR.has(t)) continue;
    const filas = await sql(`select * from public."${t.replace(/"/g, '')}"`);
    const quitar = SIN_COLUMNAS[t] ?? [];
    datos.tablas[t] = quitar.length ? filas.map(f => { const c = { ...f }; quitar.forEach(k => delete c[k]); return c; }) : filas;
  }
  const archivo = gzipSync(Buffer.from(JSON.stringify(datos)));
  return new Response(archivo, {
    headers: {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="g18_respaldo_${hoy()}.json.gz"`,
      'Cache-Control': 'no-store',
    },
  });
}
