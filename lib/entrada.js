// Ayudas para leer formularios en el servidor
export const texto = v => (v === null || v === undefined || String(v).trim() === '' ? null : String(v).trim());

// "1.250.000", "1250000", "$ 1.250.000,50" → número
export function monto(v) {
  const s = String(v ?? '').replace(/[^\d,.-]/g, '');
  if (!s) return null;
  const n = Number(s.replace(/\./g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export const fechaValida = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v ?? ''));
export const validarClave = c => (String(c ?? '').length >= 8 ? null : 'La contraseña debe tener al menos 8 caracteres.');
export const correoValido = c => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(c ?? ''));

// Mensajes de la base en palabras de la tienda
export function mensajeError(e) {
  const m = String(e?.message ?? e);
  if (m.includes('ya está cerrado')) return m;
  if (m.includes('ventas_factura_uq')) return 'Ya existe una venta con ese número de factura.';
  if (m.includes('terceros_documento_uq')) return 'Ya existe un cliente con esa cédula.';
  return `No se pudo guardar: ${m}`;
}

// Busca el cliente por cédula (o por nombre si no hay cédula); si no existe lo crea.
export async function clienteId(q, empresa, { nombre, documento, telefono }) {
  nombre = texto(nombre); documento = texto(documento); telefono = texto(telefono);
  if (!nombre && !documento) return null;
  let r = documento
    ? await q('select id, telefono from terceros where empresa_id = $1 and documento = $2', [empresa, documento])
    : await q('select id, telefono from terceros where empresa_id = $1 and lower(nombre) = lower($2) and es_cliente', [empresa, nombre]);
  if (r.length) {
    await q(`update terceros set es_cliente = true, telefono = coalesce($2, telefono) where id = $1`, [r[0].id, telefono]);
    return r[0].id;
  }
  if (!nombre) throw new Error('Escribe el nombre del cliente nuevo.');
  r = await q(`insert into terceros (empresa_id, nombre, documento, telefono, es_cliente) values ($1,$2,$3,$4,true) returning id`,
    [empresa, nombre, documento, telefono]);
  return r[0].id;
}
