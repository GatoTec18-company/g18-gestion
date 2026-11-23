'use server';
import { transaccion, uno } from '@/lib/db';
import { clienteId, fechaValida, monto, texto } from '@/lib/entrada';
import { accion, deLaEmpresa, exigir } from './comun';

// Empleado ligado al usuario (se crea la primera vez que registra una venta)
async function empleadoDelUsuario(q, ctx) {
  const r = await q('select id from empleados where empresa_id = $1 and user_id = $2', [ctx.empresaId, ctx.usuario.id]);
  if (r.length) return r[0].id;
  return (await q(`insert into empleados (empresa_id, nombre, user_id) values ($1, upper($2), $3)
                   on conflict (empresa_id, nombre) do update set user_id = coalesce(empleados.user_id, excluded.user_id)
                   returning id`, [ctx.empresaId, ctx.usuario.nombre, ctx.usuario.id]))[0].id;
}

// Venta cuyo pago llega después (Addi, Sumas Pay, cooperativa, tarjeta de crédito).
// El efectivo y las transferencias del día van como total en el Libro diario.
export const crearVenta = accion('ventas_registrar', async (ctx, fd) => {
  const fecha = texto(fd.get('fecha'));
  const total = monto(fd.get('total'));
  const entidad = texto(fd.get('entidad_id'));
  exigir(entidad, 'Elige la entidad (Addi, Sumas Pay, cooperativa o tarjeta).');
  exigir(total > 0, 'El valor debe ser mayor que cero.');
  exigir(fechaValida(fecha), 'Falta la fecha de la venta.');
  exigir(texto(fd.get('producto')), 'Escribe el producto o equipo vendido.');
  exigir(texto(fd.get('cliente_nombre')) && texto(fd.get('cliente_documento')), 'Escribe el nombre y la cédula del cliente.');

  await transaccion(async q => {
    await deLaEmpresa(q, 'entidades_financiacion', entidad, ctx.empresaId);
    const cliente = await clienteId(q, ctx.empresaId, {
      nombre: fd.get('cliente_nombre'), documento: fd.get('cliente_documento'), telefono: fd.get('cliente_telefono') });
    // Quien no ve las ventas de todos queda como vendedor de su propia venta
    let vendedor = ctx.puede('ventas_ver_todas') ? texto(fd.get('vendedor_id')) : await empleadoDelUsuario(q, ctx);
    if (vendedor === 'nuevo') {
      const nombre = texto(fd.get('vendedor_nuevo'));
      exigir(nombre, 'Escribe el nombre del vendedor nuevo.');
      vendedor = (await q(`insert into empleados (empresa_id, nombre) values ($1, upper($2))
                           on conflict (empresa_id, nombre) do update set activo = true returning id`, [ctx.empresaId, nombre]))[0].id;
    } else if (vendedor) {
      await deLaEmpresa(q, 'empleados', vendedor, ctx.empresaId);
    }
    const revision = ctx.puede('revision') ? 'aprobada' : 'pendiente';
    const [v] = await q(`insert into ventas (empresa_id, fecha, numero_factura, vendedor_id, cliente_id, total, observaciones,
                           producto, registrado_por, revision, revisado_por, revisado_en)
                         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning id`,
      [ctx.empresaId, fecha, texto(fd.get('numero_factura')), vendedor, cliente, total, texto(fd.get('observaciones')),
       texto(fd.get('producto')), ctx.usuario.id, revision,
       revision === 'aprobada' ? ctx.usuario.id : null, revision === 'aprobada' ? new Date() : null]);
    await q(`insert into venta_pagos (venta_id, forma, monto, entidad_id, detalle, referencia) values ($1,'financiada',$2,$3,$4,$5)`,
      [v.id, total, entidad, texto(fd.get('detalle')), texto(fd.get('referencia'))]);
  }, ctx.usuario.id);
  return {
    ok: true, t: Date.now(),
    mensaje: ctx.puede('revision') ? 'Venta registrada.' : 'Venta registrada. Quedó pendiente de revisión del administrador.',
  };
});

// Llega la plata de una entidad (o abono de crédito de la tienda).
export const registrarCobro = accion('cartera', async (ctx, fd) => {
  const id = texto(fd.get('venta_pago_id'));
  const valor = monto(fd.get('monto'));
  const c = await uno(`select * from v_cuentas_por_cobrar where venta_pago_id = $1 and empresa_id = $2`, [id, ctx.empresaId]);
  exigir(c, 'No se encontró la venta.');
  exigir(fechaValida(fd.get('fecha')), 'Indica la fecha del pago.');
  exigir(valor > 0, 'El monto debe ser mayor que cero.');
  exigir(valor <= c.pendiente + 0.5, `El pendiente es ${c.pendiente.toLocaleString('es-CO')}.`);
  const cuenta = texto(fd.get('cuenta_id'));
  await transaccion(async q => {
    if (cuenta) await deLaEmpresa(q, 'cuentas', cuenta, ctx.empresaId);
    const [cob] = await q(`insert into cobros (venta_pago_id, fecha, monto, cuenta_id, registrado_por) values ($1,$2,$3,$4,$5) returning id`,
      [id, fd.get('fecha'), valor, cuenta, ctx.usuario.id]);
    const [e] = await q('select ventas_mueven_caja from empresas where id = $1', [ctx.empresaId]);
    if (e.ventas_mueven_caja && cuenta) {
      const [m] = await q(`insert into movimientos (empresa_id, fecha, tipo, cuenta_id, monto, concepto, venta_pago_id)
                           values ($1,$2,'ingreso',$3,$4,$5,$6) returning id`,
        [ctx.empresaId, fd.get('fecha'), cuenta, valor,
         `Pago ${c.entidad ?? 'crédito'}${c.numero_factura ? ' ' + c.numero_factura : ''}${c.cliente ? ' · ' + c.cliente : ''}`, id]);
      await q('update cobros set movimiento_id = $2 where id = $1', [cob.id, m.id]);
    }
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Pago registrado.' };
});

// Etapa final: la plata ya llegó y se aplica a la factura en el sistema contable (cierra la venta).
export const marcarAplicado = accion('cartera', async (ctx, fd) => {
  const id = texto(fd.get('venta_pago_id'));
  const aplicar = fd.get('valor') === 'si';
  await transaccion(async q => {
    const r = await q(`select v.id venta_id, v.empresa_id, v.numero_factura from venta_pagos vp join ventas v on v.id = vp.venta_id where vp.id = $1`, [id]);
    exigir(r[0]?.empresa_id === ctx.empresaId, 'Venta no encontrada.');
    const factura = texto(fd.get('numero_factura'));
    if (aplicar) exigir(factura || r[0].numero_factura, 'Escribe el número de la factura a la que se aplicó el pago.');
    if (factura) await q('update ventas set numero_factura = $2 where id = $1', [r[0].venta_id, factura]);
    await q(`update venta_pagos set aplicado_en_factura = $2, aplicado_en = case when $2 then now() end,
               aplicado_por = case when $2 then $3::uuid end where id = $1`, [id, aplicar, ctx.usuario.id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: aplicar ? 'Aplicada en la factura: venta cerrada.' : 'Se reabrió: vuelve a "por aplicar en factura".' };
});

// El administrador aprueba o rechaza una venta financiada registrada por el personal.
export const revisarVenta = accion('revision', async (ctx, fd) => {
  const id = texto(fd.get('venta_id'));
  const decision = fd.get('decision') === 'aprobada' ? 'aprobada' : 'rechazada';
  const nota = texto(fd.get('nota'));
  exigir(decision === 'aprobada' || nota, 'Escribe el motivo del rechazo para que el vendedor lo vea.');
  await transaccion(async q => {
    await deLaEmpresa(q, 'ventas', id, ctx.empresaId);
    await q(`update ventas set revision = $2, revisado_por = $3, revisado_en = now(), nota_revision = $4 where id = $1`,
      [id, decision, ctx.usuario.id, nota]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: decision === 'aprobada' ? 'Confirmada en la plataforma: ahora espera el pago.' : 'Venta rechazada.' };
});
