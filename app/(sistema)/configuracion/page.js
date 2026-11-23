import { uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { mesActual } from '@/lib/fechas';
import { nombreMes } from '@/lib/formato';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarEmpresa } from '@/servidor/configuracion';

export default async function ConfigEmpresa({ searchParams }) {
  const { empresa, usuario } = await requerir(searchParams, 'configuracion');
  const esAdmin = usuario.empresas.every(x => x.rol === 'admin');
  const mes = mesActual();
  const [e, meta] = await Promise.all([
    uno('select nombre, nit, ventas_mueven_caja from empresas where id = $1', [empresa.id]),
    uno('select meta_ventas from metas_mes where empresa_id = $1 and mes = $2', [empresa.id, `${mes}-01`]),
  ]);
  return (
    <section className="caja">
      <h2>Datos de la empresa</h2>
      <FormAccion action={guardarEmpresa} boton="Guardar" limpiar={false}>
        <label>Nombre<input name="nombre" defaultValue={e.nombre} required /></label>
        <label>NIT<input name="nit" defaultValue={e.nit ?? ''} /></label>
        <input type="hidden" name="mes" value={mes} />
        <label>Meta de ventas de {nombreMes(mes)}<input name="meta_ventas" inputMode="numeric" defaultValue={meta?.meta_ventas ?? ''} placeholder="Ej. 50000000" /></label>
        <label className="casilla ancho" style={{ flexDirection: 'row' }}>
          <input type="checkbox" name="ventas_mueven_caja" defaultChecked={e.ventas_mueven_caja} />
          <span>Las ventas, abonos y cobros que registra el personal entran a la caja
            <small>Desactivado (recomendado): la caja se lleva con el total del día en el Libro diario y lo que registra el personal es de control.
              Actívalo solo si dejas de registrar el total del día, para no sumar dos veces.</small></span>
        </label>
      </FormAccion>
      {esAdmin && <>
        <h3 className="subt">Respaldo de los datos</h3>
        <p className="muted">Descarga una copia de todo (las dos empresas) para guardarla en tu computador o en Drive. No incluye contraseñas.
          Hazlo al menos una vez al mes, después del cierre.</p>
        <a className="btn-sec btn-link" href="/api/respaldo" download>⬇ Descargar respaldo</a>
      </>}
    </section>
  );
}
