'use server';
import { transaccion } from '@/lib/db';
import { correoValido, monto, texto, validarClave } from '@/lib/entrada';
import { MODULOS, ROLES } from '@/lib/permisos';
import { accion, deLaEmpresa, exigir } from './comun';
import { cifrarClave } from '@/lib/claves';

const entero = v => (texto(v) === null ? null : Math.round(Number(v)));
const permisosDe = fd => Object.fromEntries(MODULOS.map(m => [m.k, fd.get(`perm_${m.k}`) === 'on']));

// ---------------- Empresa ----------------
export const guardarEmpresa = accion('configuracion', async (ctx, fd) => {
  const nombre = texto(fd.get('nombre'));
  exigir(nombre, 'Escribe el nombre de la empresa.');
  const meta = monto(fd.get('meta_ventas'));
  const mes = texto(fd.get('mes'));
  await transaccion(async q => {
    await q(`update empresas set nombre = $2, nit = $3, ventas_mueven_caja = $4, telefono = $5, direccion = $6, ciudad = $7, pie_recibo = $8 where id = $1`,
      [ctx.empresaId, nombre, texto(fd.get('nit')), fd.get('ventas_mueven_caja') === 'on', texto(fd.get('telefono')),
       texto(fd.get('direccion')), texto(fd.get('ciudad')), texto(fd.get('pie_recibo'))?.slice(0, 200) ?? null]);
    if (mes && /^\d{4}-\d{2}$/.test(mes)) {
      if (meta > 0) await q(`insert into metas_mes (empresa_id, mes, meta_ventas) values ($1, $2, $3)
                             on conflict (empresa_id, mes) do update set meta_ventas = excluded.meta_ventas`, [ctx.empresaId, `${mes}-01`, meta]);
      else await q('delete from metas_mes where empresa_id = $1 and mes = $2', [ctx.empresaId, `${mes}-01`]);
    }
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Datos de la empresa guardados.' };
});

// ---------------- Usuarios (solo administradores) ----------------
export const crearUsuario = accion('configuracion', async (ctx, fd) => {
  exigir(ctx.esAdmin, 'Solo un administrador puede crear usuarios.');
  const nombre = texto(fd.get('nombre'));
  const email = String(fd.get('email') ?? '').trim().toLowerCase();
  const clave = String(fd.get('clave') ?? '');
  const rol = String(fd.get('rol') ?? '');
  const empresas = fd.getAll('empresas').map(String);
  exigir(nombre, 'Escribe el nombre.');
  exigir(correoValido(email), 'Escribe un correo válido (con él inicia sesión).');
  exigir(ROLES[rol], 'Elige un rol.');
  exigir(empresas.length, 'Elige al menos una empresa.');
  exigir(empresas.every(id => ctx.usuario.empresas.some(e => e.id === id && e.rol === 'admin')), 'Solo puedes dar acceso a empresas donde eres administrador.');
  const permisos = rol === 'admin' ? {} : permisosDe(fd);
  let creado = false;
  await transaccion(async q => {
    let [u] = await q('select id from usuarios where lower(email) = $1', [email]);
    if (!u) {
      const err = validarClave(clave);
      exigir(!err, `Contraseña temporal: ${err}`);
      [u] = await q('insert into usuarios (email, clave_hash, debe_cambiar_clave) values ($1, $2, true) returning id', [email, await cifrarClave(clave)]);
      creado = true;
    }
    for (const emp of empresas) {
      await q(`insert into miembros (user_id, empresa_id, nombre, rol, permisos) values ($1,$2,$3,$4,$5)
               on conflict (user_id, empresa_id) do update set nombre = excluded.nombre, rol = excluded.rol, permisos = excluded.permisos, activo = true`,
        [u.id, emp, nombre, rol, permisos]);
      if (rol !== 'admin') {
        await q(`insert into empleados (empresa_id, nombre, user_id) values ($1, upper($2), $3)
                 on conflict (empresa_id, nombre) do update set user_id = excluded.user_id, activo = true`, [emp, nombre, u.id]);
      }
    }
  }, ctx.usuario.id);
  return { ok: true, mensaje: creado ? `Usuario creado. Entrega a ${nombre} su correo y la contraseña temporal; al entrar deberá cambiarla.` : 'Ese correo ya existía: se le dio acceso con este rol.' };
});

export const actualizarUsuario = accion('configuracion', async (ctx, fd) => {
  exigir(ctx.esAdmin, 'Solo un administrador puede cambiar usuarios.');
  const userId = texto(fd.get('user_id'));
  const rol = String(fd.get('rol') ?? '');
  const activo = fd.get('activo') === 'on';
  exigir(ROLES[rol], 'Rol no válido.');
  exigir(userId !== ctx.usuario.id || (rol === 'admin' && activo), 'No puedes quitarte a ti mismo el rol de administrador ni desactivarte.');
  await transaccion(async q => {
    const r = await q('select 1 from miembros where user_id = $1 and empresa_id = $2', [userId, ctx.empresaId]);
    exigir(r.length, 'Usuario no encontrado en esta empresa.');
    await q(`update miembros set nombre = coalesce($3, nombre), rol = $4, permisos = $5, activo = $6 where user_id = $1 and empresa_id = $2`,
      [userId, ctx.empresaId, texto(fd.get('nombre')), rol, rol === 'admin' ? {} : permisosDe(fd), activo]);
    const [{ n }] = await q(`select count(*)::int n from miembros where empresa_id = $1 and rol = 'admin' and activo`, [ctx.empresaId]);
    exigir(n > 0, 'Debe quedar al menos un administrador activo.');
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Usuario actualizado.' };
});

export const restablecerClave = accion('configuracion', async (ctx, fd) => {
  exigir(ctx.esAdmin, 'Solo un administrador puede restablecer contraseñas.');
  const userId = texto(fd.get('user_id'));
  const clave = String(fd.get('clave') ?? '');
  const err = validarClave(clave);
  exigir(!err, err);
  await transaccion(async q => {
    const r = await q('select 1 from miembros where user_id = $1 and empresa_id = $2', [userId, ctx.empresaId]);
    exigir(r.length, 'Usuario no encontrado en esta empresa.');
    await q('update usuarios set clave_hash = $2, debe_cambiar_clave = true where id = $1', [userId, await cifrarClave(clave)]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Contraseña temporal asignada. Al entrar deberá cambiarla.' };
});

// ---------------- Catálogos ----------------
export const guardarEntidad = accion('configuracion', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const nombre = texto(fd.get('nombre'));
  const regla = String(fd.get('regla') ?? '');
  exigir(nombre, 'Escribe el nombre de la entidad.');
  exigir(['dias_calendario', 'dia_fijo_mes', 'dias_habiles', 'sin_fecha'].includes(regla), 'Elige la regla de pago.');
  const valor = entero(fd.get('valor'));
  exigir(regla === 'sin_fecha' || valor > 0, 'Indica los días o el día del mes.');
  const corte = entero(fd.get('dia_corte'));
  exigir(corte === null || (corte >= 1 && corte <= 31), 'El día de corte debe estar entre 1 y 31.');
  await transaccion(async q => {
    if (id) {
      await deLaEmpresa(q, 'entidades_financiacion', id, ctx.empresaId);
      await q(`update entidades_financiacion set nombre=$2, regla=$3, valor=$4, dia_corte=$5, nota=$6, activa=$7 where id=$1`,
        [id, nombre, regla, regla === 'sin_fecha' ? null : valor, regla === 'dia_fijo_mes' ? corte : null, texto(fd.get('nota')), fd.get('activa') === 'on']);
    } else {
      await q(`insert into entidades_financiacion (empresa_id, nombre, regla, valor, dia_corte, nota) values ($1,$2,$3,$4,$5,$6)`,
        [ctx.empresaId, nombre, regla, regla === 'sin_fecha' ? null : valor, regla === 'dia_fijo_mes' ? corte : null, texto(fd.get('nota'))]);
    }
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Entidad guardada. Las ventas nuevas usarán esta regla.' };
});

export const guardarBolsillos = accion('configuracion', async (ctx, fd) => {
  const ids = fd.getAll('id').map(String);
  const filas = ids.map(id => ({ id, nombre: texto(fd.get(`nombre_${id}`)), porcentaje: Number(String(fd.get(`pct_${id}`)).replace(',', '.')) }));
  exigir(filas.every(f => f.nombre && f.porcentaje >= 0), 'Revisa nombres y porcentajes.');
  const suma = filas.reduce((s, f) => s + f.porcentaje, 0);
  exigir(Math.abs(suma - 100) < 0.001, `Los porcentajes suman ${suma} %; deben sumar 100 %.`);
  await transaccion(async q => {
    for (const f of filas) {
      await deLaEmpresa(q, 'bolsillos', f.id, ctx.empresaId);
      await q('update bolsillos set nombre = $2, porcentaje = $3 where id = $1', [f.id, f.nombre, f.porcentaje]);
    }
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Bolsillos guardados. El nuevo reparto aplica a los ingresos que se registren desde ahora.' };
});

export const guardarCuenta = accion('configuracion', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const nombre = texto(fd.get('nombre'));
  const tipo = String(fd.get('tipo') ?? '');
  exigir(nombre, 'Escribe el nombre de la cuenta.');
  exigir(['efectivo', 'banco', 'billetera', 'caja_menor'].includes(tipo), 'Elige el tipo.');
  await transaccion(async q => {
    if (id) {
      await deLaEmpresa(q, 'cuentas', id, ctx.empresaId);
      await q('update cuentas set nombre = $2, tipo = $3, activa = $4 where id = $1', [id, nombre, tipo, fd.get('activa') === 'on']);
    } else await q('insert into cuentas (empresa_id, nombre, tipo) values ($1,$2,$3)', [ctx.empresaId, nombre, tipo]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Cuenta guardada.' };
});

export const guardarCategoria = accion('configuracion', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const nombre = texto(fd.get('nombre'));
  const tipo = String(fd.get('tipo') ?? '');
  exigir(nombre, 'Escribe el nombre.');
  exigir(['proveedores', 'inversion', 'gasto_fijo', 'gasto_variable', 'nomina', 'deuda_financieros', 'impuestos_bancarios', 'otros'].includes(tipo), 'Elige el tipo.');
  await transaccion(async q => {
    if (id) {
      await deLaEmpresa(q, 'categorias_gasto', id, ctx.empresaId);
      await q('update categorias_gasto set nombre=$2, tipo=$3, guia=$4, activa=$5 where id=$1', [id, nombre, tipo, texto(fd.get('guia')), fd.get('activa') === 'on']);
    } else await q('insert into categorias_gasto (empresa_id, nombre, tipo, guia) values ($1,$2,$3,$4)', [ctx.empresaId, nombre, tipo, texto(fd.get('guia'))]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Categoría guardada.' };
});

export const guardarGastoFijo = accion('configuracion', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const concepto = texto(fd.get('concepto'));
  const dia = entero(fd.get('dia_pago'));
  const previsto = monto(fd.get('monto_previsto'));
  exigir(concepto, 'Escribe el concepto.');
  exigir(previsto !== null && previsto >= 0, 'Escribe el monto previsto.');
  exigir(dia === null || (dia >= 1 && dia <= 31), 'El día de pago debe estar entre 1 y 31.');
  const cat = texto(fd.get('categoria_id')), bol = texto(fd.get('bolsillo_id'));
  await transaccion(async q => {
    if (cat) await deLaEmpresa(q, 'categorias_gasto', cat, ctx.empresaId);
    if (bol) await deLaEmpresa(q, 'bolsillos', bol, ctx.empresaId);
    if (id) {
      await deLaEmpresa(q, 'gastos_fijos', id, ctx.empresaId);
      await q('update gastos_fijos set concepto=$2, dia_pago=$3, monto_previsto=$4, categoria_id=$5, bolsillo_id=$6, activo=$7, compartido=$8 where id=$1',
        [id, concepto, dia, previsto, cat, bol, fd.get('activo') === 'on', fd.get('compartido') === 'on']);
    } else await q('insert into gastos_fijos (empresa_id, concepto, dia_pago, monto_previsto, categoria_id, bolsillo_id, compartido) values ($1,$2,$3,$4,$5,$6,$7)',
      [ctx.empresaId, concepto, dia, previsto, cat, bol, fd.get('compartido') === 'on']);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Gasto fijo guardado.' };
});

export const guardarProveedor = accion('configuracion', async (ctx, fd) => {
  const id = texto(fd.get('id'));
  const nombre = texto(fd.get('nombre'));
  exigir(nombre, 'Escribe el nombre del proveedor.');
  const cupo = monto(fd.get('cupo_credito'));
  const datos = [nombre, texto(fd.get('documento')), texto(fd.get('telefono')), cupo, texto(fd.get('banco')), texto(fd.get('numero_cuenta'))];
  await transaccion(async q => {
    if (id) {
      await deLaEmpresa(q, 'terceros', id, ctx.empresaId);
      await q('update terceros set nombre=$2, documento=$3, telefono=$4, cupo_credito=$5, banco=$6, numero_cuenta=$7, es_proveedor=true where id=$1', [id, ...datos]);
    } else await q('insert into terceros (empresa_id, nombre, documento, telefono, cupo_credito, banco, numero_cuenta, es_proveedor) values ($1,$2,$3,$4,$5,$6,$7,true)', [ctx.empresaId, ...datos]);
  }, ctx.usuario.id);
  return { ok: true, mensaje: 'Proveedor guardado.' };
});
