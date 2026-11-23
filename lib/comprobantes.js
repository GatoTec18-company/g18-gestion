import 'server-only';
import { Aviso } from '@/servidor/comun';

export const MAX_BYTES = 3 * 1024 * 1024;

// Cada comprobante va pegado a un registro; quién puede verlo depende del módulo de ese registro.
export const DESTINOS = {
  movimiento: { tabla: 'movimientos', columna: 'movimiento_id', permisos: ['libro'] },
  pedido: { tabla: 'pedidos', columna: 'pedido_id', permisos: ['pedidos'] },
  venta: { tabla: 'ventas', columna: 'venta_id', permisos: ['cartera', 'revision', 'ventas_registrar'] },
  factura: { tabla: 'facturas_proveedor', columna: 'factura_id', permisos: ['proveedores'] },
};

export const destinoDeFila = c => Object.keys(DESTINOS).find(k => c[DESTINOS[k].columna]);
export const puedeEnEmpresa = (ctx, destino, empresaId) =>
  DESTINOS[destino].permisos.some(p => ctx.empresasCon(p).includes(empresaId));

// Reconoce el archivo por su contenido (no por el nombre)
export function tipoReal(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 4).toString('hex') === '89504e47') return 'image/png';
  if (buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP') return 'image/webp';
  if (buf.subarray(0, 5).toString() === '%PDF-') return 'application/pdf';
  return null;
}

// Guarda un archivo (File de un formulario) pegado a un registro, dentro de una transacción.
export async function guardarComprobante(q, { empresaId, destino, registroId, archivo }) {
  if (!archivo || typeof archivo === 'string' || !archivo.size) return false;
  if (archivo.size > MAX_BYTES) throw new Aviso('El archivo pesa más de 3 MB. Toma la foto de nuevo o reduce el PDF.');
  const buf = Buffer.from(await archivo.arrayBuffer());
  const tipo = tipoReal(buf);
  if (!tipo) throw new Aviso('Solo se aceptan fotos (JPG, PNG, WEBP) o PDF.');
  const nombre = String(archivo.name || 'comprobante').slice(0, 120);
  await q(`insert into comprobantes (empresa_id, ${DESTINOS[destino].columna}, nombre, tipo, tamano, datos) values ($1,$2,$3,$4,$5,$6)`,
    [empresaId, registroId, nombre, tipo, buf.length, buf]);
  return true;
}
