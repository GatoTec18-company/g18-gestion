'use client';
import { useEffect, useId, useRef, useState } from 'react';

// Nombre con autocompletado de clientes existentes; al elegir uno se llenan cédula y teléfono.
export default function CamposCliente({ clientes, obligatorio = false }) {
  const lista = useId();
  const ref = useRef(null);
  const [doc, setDoc] = useState('');
  const [tel, setTel] = useState('');
  // Cuando el formulario se limpia tras guardar, limpiar también estos campos
  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const limpiar = () => { setDoc(''); setTel(''); };
    form.addEventListener('reset', limpiar);
    return () => form.removeEventListener('reset', limpiar);
  }, []);
  const alEscribir = e => {
    const v = e.target.value.trim().toLowerCase();
    const c = clientes.find(x => x.nombre.toLowerCase() === v || (x.documento && x.documento === v));
    if (c) { setDoc(c.documento ?? ''); setTel(c.telefono ?? ''); }
  };
  return (
    <>
      <label className="ancho">Cliente{obligatorio ? '' : ' (opcional)'}
        <input ref={ref} name="cliente_nombre" list={lista} onChange={alEscribir} placeholder="Nombre: escribe para buscar o crear" required={obligatorio} autoComplete="off" />
        <datalist id={lista}>{clientes.map(c => <option key={c.id} value={c.nombre}>{c.documento ? `CC ${c.documento}` : c.telefono ?? ''}</option>)}</datalist>
      </label>
      <label>Cédula / NIT<input name="cliente_documento" value={doc} onChange={e => setDoc(e.target.value)} inputMode="numeric" required={obligatorio} /></label>
      <label>Teléfono<input name="cliente_telefono" value={tel} onChange={e => setTel(e.target.value)} inputMode="tel" /></label>
    </>
  );
}
