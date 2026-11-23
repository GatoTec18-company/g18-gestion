'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navegacion({ items }) {
  const ruta = usePathname();
  const activo = href => (href === '/' ? ruta === '/' : ruta === href || ruta.startsWith(href + '/'));
  return (
    <nav className="nav">
      {items.map(([href, txt, contador]) => (
        <Link key={href} href={href} className={activo(href) ? 'activo' : ''}>
          {txt}{contador ? <span className="contador">{contador}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
