import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarCategoria } from '@/servidor/configuracion';

const TIPOS = [['proveedores', 'Proveedores'], ['inversion', 'Inversión'], ['gasto_fijo', 'Gasto fijo'], ['gasto_variable', 'Gasto variable'],
  ['nomina', 'Nómina'], ['deuda_financieros', 'Deuda y financieros'], ['impuestos_bancarios', 'Impuestos y bancarios'], ['otros', 'Otros']];

export default async function Categorias({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'configuracion');
  const lista = await sql('select id, nombre, tipo, guia, activa from categorias_gasto where empresa_id = $1 order by activa desc, nombre', [empresa.id]);
  const Campos = ({ x = {} }) => <>
    <input name="nombre" defaultValue={x.nombre ?? ''} placeholder="Nombre" required style={{ width: 220 }} />
    <select name="tipo" defaultValue={x.tipo ?? 'gasto_variable'}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
    <input name="guia" defaultValue={x.guia ?? ''} placeholder="Cuándo usarla" style={{ width: 320 }} />
  </>;
  return (
    <section className="caja">
      <h2>Categorías de gasto <small>el tipo agrupa los gastos en el Panel</small></h2>
      <div className="lista-config">
        {lista.map(x => (
          <FormAccion key={x.id} action={guardarCategoria} boton="Guardar" className="mini" limpiar={false}>
            <input type="hidden" name="id" value={x.id} /><Campos x={x} />
            <label className="mini"><input type="checkbox" name="activa" defaultChecked={x.activa} style={{ width: 'auto' }} /> activa</label>
          </FormAccion>))}
      </div>
      <h3 className="subt">Agregar categoría</h3>
      <FormAccion action={guardarCategoria} boton="Agregar" className="mini"><Campos /></FormAccion>
    </section>
  );
}
