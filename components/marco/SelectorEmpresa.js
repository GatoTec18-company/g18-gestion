'use client';
import { useEffect, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { cambiarEmpresa } from '@/servidor/sesion';

// Selector controlado: no usa <form action> porque React reinicia el formulario
// al terminar y el selector volvía a mostrar la empresa anterior.
export default function SelectorEmpresa({ empresas, actual }) {
  const [valor, setValor] = useState(actual);
  const [cambiando, iniciar] = useTransition();
  const router = useRouter();
  useEffect(() => { setValor(actual); }, [actual]);

  if (empresas.length < 2) return <div className="empresa-sel"><span>Empresa</span><b>{empresas[0]?.nombre}</b></div>;
  const alCambiar = e => {
    const id = e.target.value;
    setValor(id);
    const fd = new FormData();
    fd.set('empresa', id);
    iniciar(async () => { await cambiarEmpresa(fd); router.refresh(); });
  };
  return (
    <label className="empresa-sel">
      <span>Empresa{cambiando ? ' · cambiando…' : ''}</span>
      <select value={valor} onChange={alCambiar} disabled={cambiando}>
        {empresas.map(e => <option key={e.id} value={e.id}>{e.nombre}</option>)}
      </select>
    </label>
  );
}
