'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

export default function Navegacion({ items }) {
  const ruta = usePathname();
  const [destino, setDestino] = useState(null);   // marca el módulo apenas se toca, sin esperar a que cargue
  useEffect(() => { setDestino(null); }, [ruta]);
  const actual = destino ?? ruta;
  const activo = href => (href === '/' ? actual === '/' : actual === href || actual.startsWith(href + '/'));
  return (
    <nav className="nav">
      {items.map(([href, txt, contador]) => (
        <Link key={href} href={href} className={activo(href) ? 'activo' : ''} onClick={() => href !== ruta && setDestino(href)}>
          {txt}{contador ? <span className="contador">{contador}</span> : null}
        </Link>
      ))}
    </nav>
  );
}
