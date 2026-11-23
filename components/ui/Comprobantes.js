'use client';
import { useRef, useState, useTransition } from 'react';
import { comprimir } from '@/lib/comprimir';
import { borrarComprobante, subirComprobante } from '@/servidor/comprobantes';

// Lista de comprobantes de un registro con botón para adjuntar (foto con la cámara del celular o PDF).
export default function Comprobantes({ destino, id, lista = [], compacto = false, puedeQuitar = true }) {
  const [aviso, setAviso] = useState(null);
  const [enviando, iniciar] = useTransition();
  const input = useRef(null);

  const subir = async e => {
    const archivo = e.target.files?.[0];
    e.target.value = '';
    if (!archivo) return;
    setAviso(null);
    let listo;
    try { listo = await comprimir(archivo); } catch (err) { setAviso({ ok: false, mensaje: err.message }); return; }
    const fd = new FormData();
    fd.set('destino', destino); fd.set('id', id); fd.set('archivo', listo);
    iniciar(async () => setAviso(await subirComprobante(null, fd)));
  };
  const quitar = cid => {
    if (!window.confirm('¿Quitar este comprobante?')) return;
    const fd = new FormData(); fd.set('id', cid);
    iniciar(async () => setAviso(await borrarComprobante(null, fd)));
  };

  const contenido = (
    <div className="comprobantes">
      {lista.map(c => (
        <span key={c.id} className="comprobante">
          <a href={`/api/comprobante/${c.id}`} target="_blank" rel="noopener noreferrer" title={c.nombre}>
            {c.tipo === 'application/pdf' ? <span className="pdf">PDF</span> : <img src={`/api/comprobante/${c.id}`} alt={c.nombre} loading="lazy" />}
          </a>
          {puedeQuitar && <button type="button" className="quitar" onClick={() => quitar(c.id)} title="Quitar" disabled={enviando}>×</button>}
        </span>))}
      <button type="button" className="btn-sec adjuntar" onClick={() => input.current?.click()} disabled={enviando}>
        {enviando ? 'Subiendo…' : '📎 Adjuntar foto o PDF'}
      </button>
      <input ref={input} type="file" accept="image/*,application/pdf" onChange={subir} hidden />
      {aviso?.mensaje && <span className={`aviso ${aviso.ok ? 'ok' : 'error'}`}>{aviso.mensaje}</span>}
    </div>
  );
  if (!compacto) return contenido;
  return <details className="det-comprobantes"><summary>📎 Comprobantes{lista.length ? ` (${lista.length})` : ''}</summary>{contenido}</details>;
}
