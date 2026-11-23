import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarCuenta } from '@/servidor/configuracion';

const TIPOS = [['efectivo', 'Efectivo'], ['banco', 'Banco'], ['billetera', 'Billetera (Nequi, Daviplata)'], ['caja_menor', 'Caja menor']];

export default async function Cuentas({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'configuracion');
  const lista = await sql('select id, nombre, tipo, activa from cuentas where empresa_id = $1 order by activa desc, tipo, nombre', [empresa.id]);
  const Campos = ({ x = {} }) => <>
    <input name="nombre" defaultValue={x.nombre ?? ''} placeholder="Nombre" required style={{ width: 200 }} />
    <select name="tipo" defaultValue={x.tipo ?? 'banco'}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
  </>;
  return (
    <section className="caja">
      <h2>Cuentas <small>dónde está la plata</small></h2>
      <div className="lista-config">
        {lista.map(x => (
          <FormAccion key={x.id} action={guardarCuenta} boton="Guardar" className="mini" limpiar={false}>
            <input type="hidden" name="id" value={x.id} /><Campos x={x} />
            <label className="mini"><input type="checkbox" name="activa" defaultChecked={x.activa} style={{ width: 'auto' }} /> activa</label>
          </FormAccion>))}
      </div>
      <h3 className="subt">Agregar cuenta</h3>
      <FormAccion action={guardarCuenta} boton="Agregar" className="mini"><Campos /></FormAccion>
    </section>
  );
}
