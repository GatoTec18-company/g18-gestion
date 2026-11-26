import Link from 'next/link';
import { alertasRapidas } from '@/lib/alertas';
import { contexto } from '@/lib/sesion';
import { ROLES } from '@/lib/permisos';
import { sql } from '@/lib/db';
import Lateral from '@/components/marco/Lateral';
import Navegacion from '@/components/marco/Navegacion';
import SelectorEmpresa from '@/components/marco/SelectorEmpresa';
import { cerrarSesion } from '@/servidor/sesion';

export const dynamic = 'force-dynamic';

const MENU = [
  ['/', 'Panel', 'panel'],
  ['/alertas', 'Alertas', null],
  ['/ventas', 'Ventas por confirmar', 'ventas_registrar'],
  ['/cartera', 'Seguimiento de ventas', 'cartera'],
  ['/pedidos', 'Pedidos bajo encargo', 'pedidos'],
  ['/clientes', 'Clientes', 'clientes'],
  ['/libro', 'Libro diario', 'libro'],
  ['/prestamos', 'Préstamos', 'libro'],
  ['/proveedores', 'Proveedores', 'proveedores'],
  ['/creditos', 'Créditos y bancos', 'creditos'],
  ['/gastos-fijos', 'Gastos fijos', 'gastos_fijos'],
  ['/proyeccion', '¿Me alcanza la plata?', 'reportes'],
  ['/reportes', 'Reportes', 'reportes'],
  ['/cierre', 'Cierre de mes', 'cierre'],
  ['/historial', 'Historial de cambios', 'admin'],
  ['/configuracion', 'Configuración', 'configuracion'],
];

export default async function Sistema({ children }) {
  const ctx = await contexto();
  const items = MENU.filter(([, , p]) => p === 'admin' ? ctx.esAdmin : !p || ctx.puede(p) || (p === 'ventas_registrar' && ctx.puede('ventas_ver_todas')) || (p === 'cartera' && ctx.puede('revision')));
  const avisos = await alertasRapidas(ctx);
  const rojas = avisos.filter(a => a.nivel === 'rojo').length;
  let pendientes = 0;
  if (ctx.puede('revision')) {
    pendientes = (await sql(`select count(*) n from ventas where empresa_id = any($1) and revision = 'pendiente'`, [ctx.empresasCon('revision')]))[0].n;
  }
  return (
    <div className="app">
      <Lateral avisos={rojas}>
        <div className="marca solo-escritorio"><span className="logo">G18</span><span>Gestión</span></div>
        <SelectorEmpresa empresas={ctx.empresas} actual={ctx.empresa.id} />
        <Navegacion items={items.map(([h, t]) => [h, t, h === '/cartera' && pendientes ? pendientes : h === '/alertas' && avisos.length ? (rojas || avisos.length) : null])} />
        <div className="pie">
          <Link href="/mi-cuenta" className="quien" title="Mi cuenta"><b>{ctx.usuario.nombre}</b><span>{ROLES[ctx.rol]?.t ?? ctx.rol} · Mi cuenta</span></Link>
          <form action={cerrarSesion}><button className="btn-salir">Cerrar sesión</button></form>
        </div>
      </Lateral>
      <main className="contenido" data-empresa={ctx.empresa.id}>{children}</main>
    </div>
  );
}
