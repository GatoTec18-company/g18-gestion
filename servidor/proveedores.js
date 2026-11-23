'use server';
import { transaccion } from '@/lib/db';
import { fechaValida, monto, texto } from '@/lib/entrada';
import { accion, deLaEmpresa, exigir } from './comun';

const DESTINOS = ['mercancia', 'pedido_cliente', 'activos', 'saldo_inicial', 'otro'];

// Compra a crédito (lo que se le debe al proveedor). Los pagos se registran en el Libro diario con el proveedor.
export const crearFactura = accion('proveedores', async (ctx, fd) => {
  const prov = texto(fd.get('proveedor_id'));
  const valor = monto(fd.get('monto'));
  const destino = String(fd.get('destino') ?? '');
  exigir(prov, 'Elige el proveedor.');
  exigir(valor > 0, 'El valor debe ser mayor que cero.');
  exigir(fechaValida(fd.get('fecha')), 'Falta la fecha de la factura.');
  exigir(DESTINOS.includes(destino), 'Elige para qué fue la compra.');
  const venc = fechaValida(fd.get('fecha_vencimiento')) ? fd.get('fecha_vencimiento') : null;
  exigir(!venc || venc >= fd.get('fecha'), 'El vencimiento no puede ser antes de la fecha de la factura.');
  await transaccion(async q => {
    await deLaEmpresa(q, 'terceros', prov, ctx.empresaId);
    await q(`insert into facturas_proveedor (empresa_id, proveedor_id, numero, fecha, fecha_vencimiento, monto, destino, observaciones)
             values ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [ctx.empresaId, prov, texto(fd.get('numero')), fd.get('fecha'), venc, valor, destino, texto(fd.get('observaciones'))]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Factura registrada: ya suma a la deuda del proveedor.' };
});

export const anularFactura = accion('proveedores', async (ctx, fd) => {
  const id = texto(fd.get('factura_id'));
  await transaccion(async q => {
    await deLaEmpresa(q, 'facturas_proveedor', id, ctx.empresaId);
    await q('delete from facturas_proveedor where id = $1', [id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Factura anulada. Queda en el historial de cambios.' };
});
