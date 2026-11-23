import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarGastoFijo } from '@/servidor/configuracion';

export default async function ConfigGastosFijos({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'configuracion');
  const e = empresa.id;
  const [lista, categorias, bolsillos] = await Promise.all([
    sql('select * from gastos_fijos where empresa_id = $1 order by activo desc, dia_pago nulls last, concepto', [e]),
    sql('select id, nombre from categorias_gasto where empresa_id = $1 and activa order by nombre', [e]),
    sql('select id, codigo, nombre from bolsillos where empresa_id = $1 order by orden', [e]),
  ]);
  const Campos = ({ x = {} }) => <>
    <input name="concepto" defaultValue={x.concepto ?? ''} placeholder="Concepto" required style={{ width: 190 }} />
    <input name="dia_pago" defaultValue={x.dia_pago ?? ''} placeholder="Día" inputMode="numeric" style={{ width: 60 }} title="Día del mes en que se paga" />
    <input name="monto_previsto" defaultValue={x.monto_previsto ?? ''} placeholder="Previsto" inputMode="numeric" required />
    <select name="categoria_id" defaultValue={x.categoria_id ?? ''} style={{ width: 170 }}><option value="">Categoría…</option>{categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
    <select name="bolsillo_id" defaultValue={x.bolsillo_id ?? ''} style={{ width: 130 }}><option value="">Bolsillo…</option>{bolsillos.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select>
  </>;
  return (
    <section className="caja">
      <h2>Gastos fijos <small>se comparan cada mes contra lo pagado</small></h2>
      <div className="lista-config">
        {lista.map(x => (
          <FormAccion key={x.id} action={guardarGastoFijo} boton="Guardar" className="mini" limpiar={false}>
            <input type="hidden" name="id" value={x.id} /><Campos x={x} />
            <label className="mini"><input type="checkbox" name="activo" defaultChecked={x.activo} style={{ width: 'auto' }} /> activo</label>
          </FormAccion>))}
        {lista.length === 0 && <p className="vacio">Esta empresa aún no tiene gastos fijos.</p>}
      </div>
      <h3 className="subt">Agregar gasto fijo</h3>
      <FormAccion action={guardarGastoFijo} boton="Agregar" className="mini"><Campos /></FormAccion>
    </section>
  );
}
