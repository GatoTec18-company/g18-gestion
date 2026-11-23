'use server';
import { transaccion } from '@/lib/db';
import { monto, texto } from '@/lib/entrada';
import { resumenMes } from '@/lib/resumenMes';
import { accion, exigir } from './comun';

const mesValido = m => /^\d{4}-\d{2}$/.test(String(m ?? ''));

// Cierra el mes: guarda la foto y el cuadre, y bloquea el mes (nadie puede cambiar sus movimientos).
export const cerrarMes = accion('cierre', async (ctx, fd) => {
  const mes = String(fd.get('mes') ?? '');
  exigir(mesValido(mes), 'Mes no válido.');
  const efectivoContado = monto(fd.get('efectivo_contado'));
  const bancoContado = monto(fd.get('banco_contado'));
  exigir(efectivoContado !== null, 'Escribe cuánto efectivo contaste.');
  exigir(bancoContado !== null, 'Escribe el saldo del banco según el extracto o la app.');
  const r = await resumenMes(ctx.empresaId, `${mes}-01`);
  const cuadre = {
    efectivo: { libro: r.saldoEfectivo, contado: efectivoContado, diferencia: efectivoContado - r.saldoEfectivo },
    banco: { libro: r.saldoBanco, contado: bancoContado, diferencia: bancoContado - r.saldoBanco },
  };
  // Opcional: dejar el libro igual al conteo, para que el mes siguiente arranque con los saldos reales
  const ajustar = fd.get('ajustar') === 'on';
  const bolsilloAjuste = texto(fd.get('bolsillo_ajuste'));
  const ajustes = [];
  await transaccion(async q => {
    const ya = await q('select 1 from cierres_mes where empresa_id = $1 and mes = $2', [ctx.empresaId, `${mes}-01`]);
    exigir(!ya.length, 'Ese mes ya está cerrado.');
    let bolsillo = null;
    if (ajustar) {
      [bolsillo] = await q('select id, codigo from bolsillos where id = $1 and empresa_id = $2', [bolsilloAjuste, ctx.empresaId]);
      exigir(bolsillo, 'Elige el bolsillo donde va el ajuste.');
    }
    const ultimoDia = (await q(`select (date '${mes}-01' + interval '1 month - 1 day')::date d`))[0].d;
    for (const [tipoCuenta, c] of [['efectivo', cuadre.efectivo], ['banco', cuadre.banco]]) {
      const [cu] = await q(`select id from cuentas where empresa_id = $1 and tipo = $2 and activa order by (nombre = 'Bancos') desc limit 1`, [ctx.empresaId, tipoCuenta]);
      if (!cu) { exigir(!ajustar || Math.abs(c.diferencia) < 1, `No hay cuenta de ${tipoCuenta} activa para hacer el ajuste.`); continue; }
      await q(`insert into cuadres_caja (empresa_id, fecha, cuenta_id, saldo_libro, saldo_contado, nota, hecho_por) values ($1,$2,$3,$4,$5,$6,$7)`,
        [ctx.empresaId, ultimoDia, cu.id, c.libro, c.contado, `Cierre ${mes}`, ctx.usuario.id]);
      if (ajustar && Math.abs(c.diferencia) >= 1) {
        await q(`insert into movimientos (empresa_id, fecha, tipo, clase, cuenta_id, monto, concepto, bolsillo_id) values ($1,$2,$3,'ajuste',$4,$5,$6,$7)`,
          [ctx.empresaId, ultimoDia, c.diferencia > 0 ? 'ingreso' : 'egreso', cu.id, Math.abs(c.diferencia),
           `Ajuste al conteo del cierre ${mes} (${c.diferencia > 0 ? 'sobrante' : 'faltante'})`, bolsillo.id]);
        ajustes.push({ medio: tipoCuenta, diferencia: c.diferencia, bolsillo: bolsillo.codigo });
        c.ajustado = true;
        // la foto del cierre queda con los saldos ya ajustados
        if (tipoCuenta === 'efectivo') r.saldoEfectivo = c.contado; else r.saldoBanco = c.contado;
        const medio = tipoCuenta === 'efectivo' ? 'efectivo' : 'cuentas';
        const b = r.bolsillos.find(x => x.codigo === bolsillo.codigo && x.medio === medio);
        if (b) b.saldo += c.diferencia; else r.bolsillos.push({ codigo: bolsillo.codigo, nombre: '', medio, saldo: c.diferencia });
      }
    }
    r.saldoReal = r.saldoEfectivo + r.saldoBanco;
    await q(`insert into cierres_mes (empresa_id, mes, ventas, egresos, flujo_neto, saldo_real, compras_bolsillo_75, gastos_operativos,
               cartera_pendiente, proveedores_pendientes, inventario_final, detalle, cerrado_por)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [ctx.empresaId, `${mes}-01`, r.ventas, r.egresos, r.flujo, r.saldoReal, r.compras75, r.gastosOperativos,
       r.carteraPendiente, r.deudaProveedores, monto(fd.get('inventario_final')),
       { ...r, cuadre, ajustes, nota: texto(fd.get('nota')), deudaBancos: r.deudaBancos }, ctx.usuario.id]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: `Mes cerrado${ajustes.length ? ' y libro ajustado al conteo' : ''}. Ya no se pueden cambiar los movimientos de ese mes.` };
});

// Reabrir un mes cerrado (solo administrador). Queda en la auditoría.
export const reabrirMes = accion('cierre', async (ctx, fd) => {
  exigir(ctx.esAdmin, 'Solo un administrador puede reabrir un mes.');
  const mes = String(fd.get('mes') ?? '');
  exigir(mesValido(mes), 'Mes no válido.');
  await transaccion(async q => {
    await q('delete from cierres_mes where empresa_id = $1 and mes = $2', [ctx.empresaId, `${mes}-01`]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Mes reabierto: ya se pueden corregir sus movimientos. Recuerda volver a cerrarlo.' };
});
