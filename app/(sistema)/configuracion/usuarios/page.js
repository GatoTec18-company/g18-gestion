import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { MODULOS, ROLES } from '@/lib/permisos';
import { fecha } from '@/lib/formato';
import FormAccion from '@/components/formularios/FormAccion';
import CamposPermisos from '@/components/formularios/CamposPermisos';
import { actualizarUsuario, crearUsuario, restablecerClave } from '@/servidor/configuracion';

export default async function Usuarios({ searchParams }) {
  const ctx = await requerir(searchParams, 'configuracion');
  if (!ctx.esAdmin) return <section className="caja"><p>Solo un administrador puede ver y crear usuarios.</p></section>;
  const usuarios = await sql(`
    select m.user_id, m.nombre, m.rol, m.permisos, m.activo, u.email, u.ultimo_ingreso last_sign_in_at, u.debe_cambiar_clave
    from miembros m join usuarios u on u.id = m.user_id where m.empresa_id = $1 order by m.activo desc, m.rol, m.nombre`, [ctx.empresa.id]);
  const empresasAdmin = ctx.empresas.filter(e => e.rol === 'admin');

  return (
    <>
      <section className="caja">
        <h2>Crear usuario</h2>
        <FormAccion action={crearUsuario} boton="Crear usuario">
          <label>Nombre<input name="nombre" required placeholder="Ej. Jorge Silva" /></label>
          <label>Correo (para iniciar sesión)<input name="email" type="email" required autoComplete="off" /></label>
          <label>Contraseña temporal<input name="clave" type="text" minLength={8} required autoComplete="off" placeholder="Mínimo 8 caracteres" /></label>
          <div className="ancho">
            <span className="muted">Empresas</span>
            <div className="mini" style={{ marginTop: 4 }}>
              {empresasAdmin.map(e => (
                <label key={e.id} className="casilla" style={{ flexDirection: 'row' }}>
                  <input type="checkbox" name="empresas" value={e.id} defaultChecked={e.id === ctx.empresa.id} /> {e.nombre}
                </label>))}
            </div>
          </div>
          <CamposPermisos />
        </FormAccion>
        <p className="muted">La persona entra con su correo y la contraseña temporal, y el sistema le pide crear una propia.</p>
      </section>

      <section className="caja">
        <h2>Usuarios de {ctx.empresa.nombre} <small>{usuarios.length}</small></h2>
        {usuarios.map(u => (
          <details key={u.user_id} className="usuario-fila">
            <summary>
              <b>{u.nombre}</b> <span className="etiqueta-rol">{ROLES[u.rol]?.t ?? u.rol}</span>
              {!u.activo && <span className="chip gris" style={{ marginLeft: 6 }}>Inactivo</span>}
              {u.debe_cambiar_clave && <span className="chip ambar" style={{ marginLeft: 6 }}>Clave temporal</span>}
              <span className="muted"> · {u.email} · último ingreso {u.last_sign_in_at ? fecha(new Date(u.last_sign_in_at).toISOString()) : 'nunca'}</span>
              {u.rol !== 'admin' && <div className="muted" style={{ marginTop: 4 }}>
                Puede: {MODULOS.filter(m => u.permisos?.[m.k]).map(m => m.t).join(', ') || 'nada todavía'}</div>}
            </summary>
            <div className="dos" style={{ marginTop: 12 }}>
              <FormAccion action={actualizarUsuario} boton="Guardar cambios" limpiar={false}>
                <input type="hidden" name="user_id" value={u.user_id} />
                <label>Nombre<input name="nombre" defaultValue={u.nombre} /></label>
                <label className="casilla" style={{ flexDirection: 'row' }}><input type="checkbox" name="activo" defaultChecked={u.activo} /> <span>Activo<small>Si lo desactivas, no puede entrar.</small></span></label>
                <CamposPermisos rolInicial={u.rol} permisosIniciales={u.permisos} />
              </FormAccion>
              <div>
                <h3 className="subt">Restablecer contraseña</h3>
                <FormAccion action={restablecerClave} boton="Asignar temporal" className="mini">
                  <input type="hidden" name="user_id" value={u.user_id} />
                  <input name="clave" type="text" minLength={8} required placeholder="Nueva temporal" autoComplete="off" style={{ width: 180 }} />
                </FormAccion>
              </div>
            </div>
          </details>
        ))}
      </section>
    </>
  );
}
