'use client';
import { startTransition, useActionState } from 'react';

// Envía el formulario a una acción del servidor SIN que React borre los campos
// (si hay un error, lo escrito se conserva; si sale bien, quien lo usa decide limpiar).
export default function useEnvio(action, confirmar) {
  const [estado, accion, enviando] = useActionState(action, null);
  const onSubmit = e => {
    e.preventDefault();
    if (confirmar && !window.confirm(confirmar)) return;
    const fd = new FormData(e.currentTarget);
    startTransition(() => accion(fd));
  };
  return { estado, enviando, onSubmit };
}
