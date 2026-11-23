import { redirect } from 'next/navigation';
import { usuarioActual } from '@/lib/sesion';
import { cambiarClave, cerrarSesion } from '@/servidor/sesion';
import FormAccion from '@/components/formularios/FormAccion';

export const dynamic = 'force-dynamic';

export default async function CambiarClave() {
  const u = await usuarioActual();
  if (!u) redirect('/login');
  return (
    <div className="acceso">
      <div className="acceso-caja">
        <div className="marca oscura"><span className="logo">G18</span><span>Gestión</span></div>
        <h1>Cambiar contraseña</h1>
        <p className="sub">{u.debeCambiarClave ? `Hola ${u.nombre}: el administrador te asignó una contraseña temporal. Crea una tuya para continuar.` : `Hola ${u.nombre}.`}</p>
        <FormAccion action={cambiarClave} boton="Guardar contraseña" className="formulario una-col" limpiar={false}>
          <label>Contraseña actual<input name="actual" type="password" required autoComplete="current-password" /></label>
          <label>Nueva contraseña (mínimo 8)<input name="nueva" type="password" required minLength={8} autoComplete="new-password" /></label>
          <label>Repite la nueva<input name="nueva2" type="password" required minLength={8} autoComplete="new-password" /></label>
        </FormAccion>
        <form action={cerrarSesion}><button className="btn-sec" style={{ marginTop: 12 }}>Salir</button></form>
      </div>
    </div>
  );
}
