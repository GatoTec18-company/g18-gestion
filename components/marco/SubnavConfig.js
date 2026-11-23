'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const ITEMS = [
  ['/configuracion', 'Empresa'], ['/configuracion/usuarios', 'Usuarios y permisos'], ['/configuracion/entidades', 'Entidades de financiación'],
  ['/configuracion/bolsillos', 'Bolsillos'], ['/configuracion/cuentas', 'Cuentas'], ['/configuracion/categorias', 'Categorías de gasto'],
  ['/configuracion/gastos-fijos', 'Gastos fijos'], ['/configuracion/proveedores', 'Proveedores'],
];

export default function SubnavConfig() {
  const ruta = usePathname();
  return <nav className="subnav">{ITEMS.map(([h, t]) => <Link key={h} href={h} className={ruta === h ? 'activo' : ''}>{t}</Link>)}</nav>;
}
