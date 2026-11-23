import { redirect } from 'next/navigation';
import { usuarioActual } from '@/lib/sesion';
import { inicioPara } from '@/lib/permisos';
import { crearPrimerAdmin, hayAdministrador, iniciarSesion } from '@/servidor/sesion';
import FormAccion from '@/components/formularios/FormAccion';

export const dynamic = 'force-dynamic';

export default async function Login() {
  const u = await usuarioActual();
  if (u) redirect(inicioPara(u.empresas[0].rol, u.empresas[0].permisos));
  const primerUso = !(await hayAdministrador());

  return (
    <div className="acceso">
      <div className="acceso-caja">
        <div className="marca oscura"><span className="logo">G18</span><span>Gestión</span></div>
        {primerUso ? (
          <>
            <h1>Crear el administrador</h1>
            <p className="sub">Es la primera vez que se abre el sistema. Esta cuenta tendrá acceso total a las dos empresas y podrá crear los demás usuarios.</p>
            <FormAccion action={crearPrimerAdmin} boton="Crear y entrar" className="formulario una-col" limpiar={false}>
              <label>Tu nombre<input name="nombre" required autoComplete="name" /></label>
              <label>Correo<input name="email" type="email" required autoComplete="username" /></label>
              <label>Contraseña (mínimo 8 caracteres)<input name="clave" type="password" required minLength={8} autoComplete="new-password" /></label>
              <label>Repite la contraseña<input name="clave2" type="password" required minLength={8} autoComplete="new-password" /></label>
            </FormAccion>
          </>
        ) : (
          <>
            <h1>Iniciar sesión</h1>
            <FormAccion action={iniciarSesion} boton="Entrar" className="formulario una-col" limpiar={false}>
              <label>Correo<input name="email" type="email" required autoComplete="username" autoFocus /></label>
              <label>Contraseña<input name="clave" type="password" required autoComplete="current-password" /></label>
            </FormAccion>
            <p className="muted">¿Olvidaste la contraseña? Pídele al administrador que te asigne una nueva.</p>
          </>
        )}
      </div>
    </div>
  );
}
