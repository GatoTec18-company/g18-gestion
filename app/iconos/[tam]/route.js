import { icono } from '@/lib/icono';

// /iconos/192, /iconos/512 y /iconos/512-recortable (para Android)
export async function GET(_req, { params }) {
  const { tam } = await params;
  const [n, tipo] = String(tam).split('-');
  if (!['192', '512'].includes(n)) return new Response('No encontrado', { status: 404 });
  const r = icono(Number(n), { margen: tipo === 'recortable' ? 0.12 : 0 });
  r.headers.set('Cache-Control', 'public, max-age=604800');
  return r;
}
