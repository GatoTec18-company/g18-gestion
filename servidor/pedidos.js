'use server';
import { redirect } from 'next/navigation';
import { transaccion, uno } from '@/lib/db';
import { clienteId, fechaValida, monto, texto } from '@/lib/entrada';
import { accion, deLaEmpresa, exigir } from './comun';

const ESTADOS = ['por_pedir', 'pedido', 'en_camino', 'recibido_en_tienda', 'entregado', 'cancelado'];

// Abono del cliente: registro de control; solo mueve la caja si la empresa lo tiene activado.
async function registrarAbono(q, ctx, pedido, { fecha, valor, cuenta, cliente }) {
  if (cuenta) await deLaEmpresa(q, 'cuentas', cuenta, ctx.empresaId);
  const [a] = await q(`insert into pedido_abonos (pedido_id, fecha, monto, cuenta_id, registrado_por) values ($1,$2,$3,$4,$5) returning id`,
    [pedido.id, fecha, valor, cuenta, ctx.usuario.id]);
  const [e] = await q('select ventas_mueven_caja from empresas where id = $1', [ctx.empresaId]);
  if (e.ventas_mueven_caja && cuenta) {
    const [m] = await q(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, pedido_id, tercero_id)
                         values ($1,$2,'ingreso',$3,$4,$5,$6,$7) returning id`,
      [ctx.empresaId, fecha, cuenta, valor, `Abono ${pedido.numero}`, pedido.id, cliente]);
    await q('update pedido_abonos set movimiento_id = $2 where id = $1', [a.id, m.id]);
  }
}

export async function crearPedido(prev, fd) {
  const r = await crearPedidoInterno(prev, fd);
  if (r?.id) redirect(`/pedidos/${r.id}`);
  return r;
}

const crearPedidoInterno = accion('pedidos', async (ctx, fd) => {
  const fecha = texto(fd.get('fecha_pedido'));
  const valor = monto(fd.get('valor'));
  const abono = monto(fd.get('abono')) ?? 0;
  exigir(fechaValida(fecha), 'Falta la fecha del pedido.');
  exigir(texto(fd.get('producto')), 'Escribe el producto.');
  exigir(abono >= 0, 'El abono no puede ser negativo.');
  exigir(valor === null || abono <= valor, 'El abono es mayor que el valor del pedido.');
  const id = await transaccion(async q => {
    const cliente = await clienteId(q, ctx.empresaId, {
      nombre: fd.get('cliente_nombre'), documento: fd.get('cliente_documento'), telefono: fd.get('cliente_telefono') });
    const prov = texto(fd.get('proveedor_id'));
    if (prov) await deLaEmpresa(q, 'terceros', prov, ctx.empresaId);
    const [p] = await q(`insert into pedidos (empresa_id, fecha_pedido, fecha_estimada, cliente_id, proveedor_id, estado, observaciones)
                         values ($1,$2,$3,$4,$5,'por_pedir',$6) returning id, numero`,
      [ctx.empresaId, fecha, fechaValida(fd.get('fecha_estimada')) ? fd.get('fecha_estimada') : null, cliente, prov, texto(fd.get('observaciones'))]);
    await q('insert into pedido_items (pedido_id, descripcion, precio_venta) values ($1,$2,$3)', [p.id, texto(fd.get('producto')), valor]);
    if (abono > 0) await registrarAbono(q, ctx, p, { fecha, valor: abono, cuenta: texto(fd.get('cuenta_id')), cliente });
    return p.id;
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Pedido creado.', id };
});

export const actualizarPedido = accion('pedidos', async (ctx, fd) => {
  const id = texto(fd.get('pedido_id'));
  const estado = texto(fd.get('estado'));
  exigir(ESTADOS.includes(estado), 'Estado no válido.');
  await transaccion(async q => {
    await deLaEmpresa(q, 'pedidos', id, ctx.empresaId);
    const prov = texto(fd.get('proveedor_id'));
    if (prov) await deLaEmpresa(q, 'terceros', prov, ctx.empresaId);
    await q(`update pedidos set estado = $2::estado_pedido, fecha_estimada = $3, proveedor_id = $4, observaciones = $5,
               fecha_entrega_real = case when $2::estado_pedido = 'entregado'
                 then coalesce($6::date, fecha_entrega_real, current_date) else null end
             where id = $1`,
      [id, estado, fechaValida(fd.get('fecha_estimada')) ? fd.get('fecha_estimada') : null, prov,
       texto(fd.get('observaciones')), fechaValida(fd.get('fecha_entrega_real')) ? fd.get('fecha_entrega_real') : null]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Pedido actualizado.' };
});

export const guardarItem = accion('pedidos', async (ctx, fd) => {
  const pedido = texto(fd.get('pedido_id'));
  const item = texto(fd.get('item_id'));
  const descripcion = texto(fd.get('descripcion'));
  exigir(descripcion, 'Escribe la descripción.');
  const precio = monto(fd.get('precio_venta'));
  const cantidad = monto(fd.get('cantidad')) || 1;
  await transaccion(async q => {
    await deLaEmpresa(q, 'pedidos', pedido, ctx.empresaId);
    if (item) await q('update pedido_items set descripcion = $2, precio_venta = $3, cantidad = $4 where id = $1 and pedido_id = $5', [item, descripcion, precio, cantidad, pedido]);
    else await q('insert into pedido_items (pedido_id, descripcion, precio_venta, cantidad) values ($1,$2,$3,$4)', [pedido, descripcion, precio, cantidad]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: item ? 'Producto actualizado.' : 'Producto agregado.' };
});

export const abonarPedido = accion('pedidos', async (ctx, fd) => {
  const p = await uno('select * from v_pedidos where id = $1 and empresa_id = $2', [texto(fd.get('pedido_id')), ctx.empresaId]);
  exigir(p, 'No se encontró el pedido.');
  const valor = monto(fd.get('monto'));
  exigir(fechaValida(fd.get('fecha')), 'Falta la fecha.');
  exigir(valor > 0, 'El monto debe ser mayor que cero.');
  exigir(p.saldo === null || valor <= p.saldo + 0.5, `El saldo del pedido es ${Number(p.saldo).toLocaleString('es-CO')}.`);
  await transaccion(async q => {
    const [{ cliente_id }] = await q('select cliente_id from pedidos where id = $1', [p.id]);
    await registrarAbono(q, ctx, p, { fecha: fd.get('fecha'), valor, cuenta: texto(fd.get('cuenta_id')), cliente: cliente_id });
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Abono registrado.' };
});

// Pago al proveedor por un pedido: sale plata de la caja (egreso real en el libro).
export const pagarProveedorPedido = accion('pedidos_costos', async (ctx, fd) => {
  const p = await uno('select * from v_pedidos where id = $1 and empresa_id = $2', [texto(fd.get('pedido_id')), ctx.empresaId]);
  exigir(p, 'No se encontró el pedido.');
  const valor = monto(fd.get('monto'));
  exigir(fechaValida(fd.get('fecha')), 'Falta la fecha.');
  exigir(valor > 0, 'El monto debe ser mayor que cero.');
  exigir(texto(fd.get('cuenta_id')), 'Elige de qué cuenta sale.');
  exigir(texto(fd.get('bolsillo_id')), 'Elige de qué bolsillo sale.');
  await transaccion(async q => {
    await deLaEmpresa(q, 'cuentas', fd.get('cuenta_id'), ctx.empresaId);
    await deLaEmpresa(q, 'bolsillos', fd.get('bolsillo_id'), ctx.empresaId);
    const prov = texto(fd.get('proveedor_id'));
    if (prov) await deLaEmpresa(q, 'terceros', prov, ctx.empresaId);
    const [cat] = await q(`select id from categorias_gasto where empresa_id = $1 and tipo = 'proveedores' order by (nombre = 'Pedidos de clientes') desc limit 1`, [ctx.empresaId]);
    await q(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, categoria_id, bolsillo_id, tercero_id, pedido_id)
             values ($1,$2,'egreso',$3,$4,$5,$6,$7,$8,$9)`,
      [ctx.empresaId, fd.get('fecha'), fd.get('cuenta_id'), valor, `Pago proveedor ${p.numero}`, cat?.id, fd.get('bolsillo_id'), prov, p.id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Pago al proveedor registrado en el libro diario.' };
});
