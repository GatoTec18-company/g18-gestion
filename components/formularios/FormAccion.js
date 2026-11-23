'use client';
import { useEffect, useRef } from 'react';
import useEnvio from './useEnvio';

// Formulario genérico para acciones del servidor que devuelven { ok, mensaje }.
export default function FormAccion({ action, boton = 'Guardar', children, className = 'formulario', limpiar = true, confirmar }) {
  const { estado, enviando, onSubmit } = useEnvio(action, confirmar);
  const ref = useRef(null);
  useEffect(() => { if (estado?.ok && limpiar) ref.current?.reset(); }, [estado, limpiar]);
  return (
    <form ref={ref} onSubmit={onSubmit}>
      <div className={className}>
        {children}
        <div><button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : boton}</button></div>
      </div>
      {estado?.mensaje && <p className={`aviso ${estado.ok ? 'ok' : 'error'}`}>{estado.mensaje}</p>}
    </form>
  );
}
