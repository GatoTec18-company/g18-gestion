'use client';
import { useEffect, useState, useTransition } from 'react';
import { cambiarEmpresa } from '@/servidor/sesion';

const CANAL = 'g18-empresa';

// Al cambiar de empresa se recarga la página completa, para que ningún formulario se quede con
// cuentas o bolsillos de la empresa anterior. También avisa a las otras ventanas abiertas de la app.
export default function SelectorEmpresa({ empresas, actual }) {
  const [valor, setValor] = useState(actual);
  const [cambiando, iniciar] = useTransition();
  useEffect(() => { setValor(actual); }, [actual]);
  useEffect(() => {
    if (typeof BroadcastChannel === 'undefined') return;
    const c = new BroadcastChannel(CANAL);
    c.onmessage = e => { if (e.data !== actual) window.location.reload(); };
    return () => c.close();
  }, [actual]);

  if (empresas.length < 2) return <div className="empresa-sel"><span>Empresa</span><b>{empresas[0]?.nombre}</b></div>;
  const alCambiar = e => {
    const id = e.target.value;
    setValor(id);
    const fd = new FormData();
    fd.set('empresa', id);
    iniciar(async () => {
      await cambiarEmpresa(fd);
      try { const c = new BroadcastChannel(CANAL); c.postMessage(id); c.close(); } catch {}
      window.location.reload();
    });
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
