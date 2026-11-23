import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarEntidad } from '@/servidor/configuracion';

const REGLAS = [['dias_calendario', 'Días calendario después de la venta'], ['dias_habiles', 'Días hábiles después (sin sábados, domingos ni festivos)'],
  ['dia_fijo_mes', 'Día fijo del mes siguiente (con día de corte)'], ['sin_fecha', 'Sin fecha fija']];

function Campos({ x = {} }) {
  return <>
    <input name="nombre" defaultValue={x.nombre ?? ''} placeholder="Nombre" required style={{ width: 150 }} />
    <select name="regla" defaultValue={x.regla ?? 'dias_calendario'} style={{ width: 260 }}>{REGLAS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
    <input name="valor" defaultValue={x.valor ?? ''} placeholder="Días / día" inputMode="numeric" style={{ width: 90 }} title="Días, o el día del mes en que pagan" />
    <input name="dia_corte" defaultValue={x.dia_corte ?? ''} placeholder="Corte" inputMode="numeric" style={{ width: 70 }} title="Solo para día fijo del mes" />
    <input name="nota" defaultValue={x.nota ?? ''} placeholder="Nota" style={{ width: 220 }} />
  </>;
}

export default async function Entidades({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'configuracion');
  const lista = await sql('select * from entidades_financiacion where empresa_id = $1 order by activa desc, nombre', [empresa.id]);
  return (
    <section className="caja">
      <h2>Entidades de financiación <small>la regla calcula la fecha estimada de pago de cada venta</small></h2>
      <div className="lista-config">
        {lista.map(x => (
          <FormAccion key={x.id} action={guardarEntidad} boton="Guardar" className="mini" limpiar={false}>
            <input type="hidden" name="id" value={x.id} /><Campos x={x} />
            <label className="mini"><input type="checkbox" name="activa" defaultChecked={x.activa} style={{ width: 'auto' }} /> activa</label>
          </FormAccion>))}
      </div>
      <h3 className="subt">Agregar entidad</h3>
      <FormAccion action={guardarEntidad} boton="Agregar" className="mini"><Campos /></FormAccion>
      <p className="muted">Ejemplos: Addi → 7 días calendario. Tarjeta de crédito → 1 día hábil. Sumas Pay → día 10, corte 25. Cooperativa → sin fecha fija.</p>
    </section>
  );
}
