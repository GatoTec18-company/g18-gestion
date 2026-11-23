'use client';
import { startTransition, useActionState, useState } from 'react';

// Envía el formulario a una acción del servidor SIN que React borre los campos
// (si hay un error, lo escrito se conserva; si sale bien, quien lo usa decide limpiar).
// preparar(fd): paso opcional antes de enviar (ej. comprimir la foto del comprobante).
export default function useEnvio(action, confirmar, preparar) {
  const [estado, accion, enviando] = useActionState(action, null);
  const [errorLocal, setErrorLocal] = useState(null);
  const onSubmit = async e => {
    e.preventDefault();
    if (confirmar && !window.confirm(confirmar)) return;
    let fd = new FormData(e.currentTarget);
    setErrorLocal(null);
    if (preparar) {
      try { fd = await preparar(fd); } catch (err) { setErrorLocal({ ok: false, mensaje: err.message }); return; }
    }
    startTransition(() => accion(fd));
  };
  return { estado: errorLocal ?? estado, enviando, onSubmit };
}
