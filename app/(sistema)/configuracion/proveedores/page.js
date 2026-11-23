import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarProveedor } from '@/servidor/configuracion';

export default async function ConfigProveedores({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'configuracion');
  const lista = await sql('select id, nombre, documento, telefono, cupo_credito, banco, numero_cuenta from terceros where empresa_id = $1 and es_proveedor order by nombre', [empresa.id]);
  const Campos = ({ x = {} }) => <>
    <input name="nombre" defaultValue={x.nombre ?? ''} placeholder="Nombre" required style={{ width: 150 }} />
    <input name="documento" defaultValue={x.documento ?? ''} placeholder="NIT" style={{ width: 110 }} />
    <input name="telefono" defaultValue={x.telefono ?? ''} placeholder="Teléfono" style={{ width: 110 }} />
    <input name="cupo_credito" defaultValue={x.cupo_credito ?? ''} placeholder="Cupo de crédito" inputMode="numeric" />
    <input name="banco" defaultValue={x.banco ?? ''} placeholder="Banco" style={{ width: 110 }} />
    <input name="numero_cuenta" defaultValue={x.numero_cuenta ?? ''} placeholder="N° de cuenta" style={{ width: 140 }} />
  </>;
  return (
    <section className="caja">
      <h2>Proveedores</h2>
      <div className="lista-config">
        {lista.map(x => (
          <FormAccion key={x.id} action={guardarProveedor} boton="Guardar" className="mini" limpiar={false}>
            <input type="hidden" name="id" value={x.id} /><Campos x={x} />
          </FormAccion>))}
      </div>
      <h3 className="subt">Agregar proveedor</h3>
      <FormAccion action={guardarProveedor} boton="Agregar" className="mini"><Campos /></FormAccion>
    </section>
  );
}
