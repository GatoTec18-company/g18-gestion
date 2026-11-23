'use server';
import { transaccion } from '@/lib/db';
import { fechaValida, monto, texto } from '@/lib/entrada';
import { accion, deLaEmpresa, exigir } from './comun';

const TIPOS = ['credito', 'tarjeta', 'prestamo', 'otro'];
const DESTINOS = ['mercancia', 'pedido_cliente', 'activos', 'otro'];
const entero = v => (texto(v) === null ? null : Math.round(Number(v)));

export const guardarCredito = accion('creditos', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const entidad = texto(fd.get('entidad'));
  const tipo = String(fd.get('tipo') ?? '');
  const saldo = monto(fd.get('saldo_inicial'));
  const dia = entero(fd.get('dia_pago'));
  exigir(entidad, 'Escribe el banco o entidad.');
  exigir(TIPOS.includes(tipo), 'Elige el tipo.');
  exigir(saldo !== null && saldo >= 0, 'Escribe cuánto se debía.');
  exigir(fechaValida(fd.get('fecha_inicial')), 'Escribe la fecha de ese saldo.');
  exigir(dia === null || (dia >= 1 && dia <= 31), 'El día de pago debe estar entre 1 y 31.');
  const datos = [entidad, tipo, texto(fd.get('descripcion')), saldo, fd.get('fecha_inicial'), monto(fd.get('cuota')), dia];
  await transaccion(async q => {
    if (id) {
      await deLaEmpresa(q, 'creditos', id, ctx.empresaId);
      await q(`update creditos set entidad=$2, tipo=$3, descripcion=$4, saldo_inicial=$5, fecha_inicial=$6, cuota=$7, dia_pago=$8, activo=$9 where id=$1`,
        [id, ...datos, fd.get('activo') === 'on']);
    } else {
      await q(`insert into creditos (empresa_id, entidad, tipo, descripcion, saldo_inicial, fecha_inicial, cuota, dia_pago)
               values ($1,$2,$3,$4,$5,$6,$7,$8)`, [ctx.empresaId, ...datos]);
    }
  }, ctx.usuario.id);
  return { ok: true, mensaje: id ? 'Crédito actualizado.' : 'Crédito registrado.' };
});

// Algo que aumenta la deuda: una compra con la tarjeta, un nuevo desembolso, intereses
export const agregarCargo = accion('creditos', async (ctx, fd) => {
  const credito = texto(fd.get('credito_id'));
  const valor = monto(fd.get('monto'));
  const destino = String(fd.get('destino') ?? 'otro');
  exigir(valor > 0, 'El valor debe ser mayor que cero.');
  exigir(fechaValida(fd.get('fecha')), 'Falta la fecha.');
  exigir(texto(fd.get('concepto')), 'Escribe qué fue.');
  exigir(DESTINOS.includes(destino), 'Elige para qué fue.');
  await transaccion(async q => {
    await deLaEmpresa(q, 'creditos', credito, ctx.empresaId);
    await q(`insert into credito_cargos (credito_id, fecha, monto, concepto, destino, registrado_por) values ($1,$2,$3,$4,$5,$6)`,
      [credito, fd.get('fecha'), valor, texto(fd.get('concepto')), destino, ctx.usuario.id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Registrado: la deuda aumentó.' };
});

export const anularCargo = accion('creditos', async (ctx, fd) => {
  const id = texto(fd.get('cargo_id'));
  await transaccion(async q => {
    const [c] = await q('select cr.empresa_id from credito_cargos g join creditos cr on cr.id = g.credito_id where g.id = $1', [id]);
    exigir(c?.empresa_id === ctx.empresaId, 'No encontrado.');
    await q('delete from credito_cargos where id = $1', [id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Anulado.' };
});
