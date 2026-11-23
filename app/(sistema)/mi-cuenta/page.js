import { contexto } from '@/lib/sesion';
import { ROLES } from '@/lib/permisos';
import { Encabezado } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { cambiarMiClave, cambiarMiNombre } from '@/servidor/sesion';

export default async function MiCuenta({ searchParams }) {
  const ctx = await contexto(searchParams);
  const u = ctx.usuario;
  return (
    <>
      <Encabezado titulo="Mi cuenta" sub={u.email} />
      <div className="dos">
        <section className="caja">
          <h2>Mis datos</h2>
          <FormAccion action={cambiarMiNombre} boton="Guardar nombre" limpiar={false}>
            <label className="ancho">Nombre<input name="nombre" defaultValue={u.nombre} required maxLength={80} /></label>
          </FormAccion>
          <h3 className="subt">Mis empresas</h3>
          {u.empresas.map(e => <p key={e.id} style={{ margin: '0 0 4px' }}><b>{e.nombre}</b> <span className="muted">· {ROLES[e.rol]?.t ?? e.rol}</span></p>)}
          <p className="muted">El correo y los permisos los cambia el administrador.</p>
        </section>
        <section className="caja">
          <h2>Cambiar contraseña</h2>
          <FormAccion action={cambiarMiClave} boton="Cambiar contraseña">
            <label className="ancho">Contraseña actual<input name="actual" type="password" required autoComplete="current-password" /></label>
            <label>Nueva (mínimo 8)<input name="nueva" type="password" required minLength={8} autoComplete="new-password" /></label>
            <label>Repite la nueva<input name="nueva2" type="password" required minLength={8} autoComplete="new-password" /></label>
          </FormAccion>
        </section>
      </div>
    </>
  );
}
