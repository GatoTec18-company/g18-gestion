'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

// Menú lateral. En el celular se pliega detrás de una barra superior con el botón ☰.
export default function Lateral({ children, avisos = 0 }) {
  const [abierto, setAbierto] = useState(false);
  const ruta = usePathname();
  useEffect(() => { setAbierto(false); }, [ruta]);
  return (
    <aside className={`lateral${abierto ? ' abierto' : ''}`}>
      <div className="barra-movil">
        <div className="marca"><span className="logo">G18</span><span>Gestión</span></div>
        <button type="button" className="boton-menu" onClick={() => setAbierto(a => !a)} aria-expanded={abierto} aria-label="Menú">
          {abierto ? '✕' : '☰'}{!abierto && avisos > 0 && <span className="contador">{avisos}</span>}
        </button>
      </div>
      <div className="lateral-cuerpo">{children}</div>
    </aside>
  );
}
