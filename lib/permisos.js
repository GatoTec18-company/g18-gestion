// Módulos de la app y permisos. Lo usa el servidor (para bloquear) y el navegador (para mostrar casillas).

export const MODULOS = [
  { k: 'panel', t: 'Panel financiero', d: 'Ventas del día, egresos, saldos, bolsillos y alertas', grupo: 'Finanzas' },
  { k: 'libro', t: 'Libro diario', d: 'Ver y registrar los ingresos y egresos de la caja', grupo: 'Finanzas' },
  { k: 'gastos_fijos', t: 'Gastos fijos', d: 'Previsto contra pagado de arriendo, nómina, servicios…', grupo: 'Finanzas' },
  { k: 'proveedores', t: 'Proveedores', d: 'Estado de cuenta, cupos y pagos a proveedores', grupo: 'Finanzas' },
  { k: 'ventas_registrar', t: 'Registrar ventas', d: 'Crear ventas. Las financiadas quedan pendientes de revisión', grupo: 'Ventas' },
  { k: 'ventas_ver_todas', t: 'Ver ventas de todos', d: 'Sin este permiso solo ve las ventas que él registró', grupo: 'Ventas' },
  { k: 'cartera', t: 'Pagos y facturas de ventas', d: 'Registrar cuándo paga la entidad y aplicar el pago en la factura', grupo: 'Ventas' },
  { k: 'revision', t: 'Confirmar ventas', d: 'Confirmar que la venta aparece en la plataforma, o rechazarla', grupo: 'Ventas' },
  { k: 'pedidos', t: 'Pedidos bajo encargo', d: 'Crear pedidos, registrar abonos del cliente y cambiar el estado', grupo: 'Pedidos' },
  { k: 'pedidos_costos', t: 'Costos de pedidos', d: 'Ver lo pagado al proveedor y la utilidad; registrar pagos al proveedor', grupo: 'Pedidos' },
  { k: 'configuracion', t: 'Configuración', d: 'Usuarios, entidades, bolsillos, cuentas, categorías y datos de la empresa', grupo: 'Administración' },
];

export const ROLES = {
  admin: { t: 'Administrador', d: 'Acceso total a todo.', base: MODULOS.map(m => m.k) },
  vendedor: { t: 'Vendedor', d: 'Registra sus ventas (las financiadas van a revisión) y pedidos.', base: ['ventas_registrar', 'pedidos'] },
  cajero: { t: 'Cajero', d: 'Registra ventas y pedidos; ve las ventas de todos.', base: ['ventas_registrar', 'ventas_ver_todas', 'pedidos'] },
  colaborador: { t: 'Colaborador', d: 'Solo lo que el administrador le habilite.', base: [] },
};

export const permisosBase = rol => Object.fromEntries((ROLES[rol]?.base ?? []).map(k => [k, true]));

export function puede(rol, permisos, k) {
  if (rol === 'admin') return true;
  return permisos?.[k] === true;
}

// Página de inicio según lo que la persona puede ver
export function inicioPara(rol, permisos) {
  const orden = [['panel', '/'], ['ventas_registrar', '/ventas'], ['pedidos', '/pedidos'], ['cartera', '/cartera'], ['revision', '/cartera'], ['libro', '/libro']];
  return orden.find(([k]) => puede(rol, permisos, k))?.[1] ?? '/sin-permiso';
}
