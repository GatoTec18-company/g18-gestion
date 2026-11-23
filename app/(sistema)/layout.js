import { contexto } from '@/lib/sesion';
import { ROLES } from '@/lib/permisos';
import { sql } from '@/lib/db';
import Navegacion from '@/components/marco/Navegacion';
import SelectorEmpresa from '@/components/marco/SelectorEmpresa';
import { cerrarSesion } from '@/servidor/sesion';

export const dynamic = 'force-dynamic';

const MENU = [
  ['/', 'Panel', 'panel'],
  ['/ventas', 'Ventas por confirmar', 'ventas_registrar'],
  ['/cartera', 'Seguimiento de ventas', 'cartera'],
  ['/pedidos', 'Pedidos bajo encargo', 'pedidos'],
  ['/libro', 'Libro diario', 'libro'],
  ['/proveedores', 'Proveedores', 'proveedores'],
  ['/gastos-fijos', 'Gastos fijos', 'gastos_fijos'],
  ['/configuracion', 'Configuración', 'configuracion'],
];

export default async function Sistema({ children }) {
  const ctx = await contexto();
  const items = MENU.filter(([, , p]) => ctx.puede(p) || (p === 'ventas_registrar' && ctx.puede('ventas_ver_todas')) || (p === 'cartera' && ctx.puede('revision')));
  let pendientes = 0;
  if (ctx.puede('revision')) {
    pendientes = (await sql(`select count(*) n from ventas where empresa_id = $1 and revision = 'pendiente'`, [ctx.empresa.id]))[0].n;
  }
  return (
    <div className="app">
      <aside className="lateral">
        <div className="marca"><span className="logo">G18</span><span>Gestión</span></div>
        <SelectorEmpresa empresas={ctx.empresas} actual={ctx.empresa.id} />
        <Navegacion items={items.map(([h, t]) => [h, t, h === '/cartera' && pendientes ? pendientes : null])} />
        <div className="pie">
          <div className="quien"><b>{ctx.usuario.nombre}</b><span>{ROLES[ctx.rol]?.t ?? ctx.rol}</span></div>
          <form action={cerrarSesion}><button className="btn-salir">Cerrar sesión</button></form>
        </div>
      </aside>
      <main className="contenido">{children}</main>
    </div>
  );
}
