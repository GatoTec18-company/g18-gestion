import { uno } from '@/lib/db';
import { contextoAccion, SinPermiso } from '@/lib/sesion';
import { destinoDeFila, puedeEnEmpresa } from '@/lib/comprobantes';

export const dynamic = 'force-dynamic';

export async function GET(_req, { params }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) return new Response('No encontrado', { status: 404 });
  let ctx;
  try { ctx = await contextoAccion(null); } catch (e) {
    if (e instanceof SinPermiso) return new Response(e.message, { status: 401 });
    throw e;
  }
  const c = await uno('select * from comprobantes where id = $1', [id]);
  if (!c || !puedeEnEmpresa(ctx, destinoDeFila(c), c.empresa_id)) return new Response('No encontrado', { status: 404 });
  return new Response(c.datos, {
    headers: {
      'Content-Type': c.tipo,
      'Content-Disposition': `inline; filename="${encodeURIComponent(c.nombre)}"`,
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
      ...(c.tipo.startsWith('image/') ? { 'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox" } : {}),
    },
  });
}
