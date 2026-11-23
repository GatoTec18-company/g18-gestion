import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import FormAccion from '@/components/formularios/FormAccion';
import { guardarBolsillos } from '@/servidor/configuracion';

export default async function Bolsillos({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'configuracion');
  const lista = await sql('select id, codigo, nombre, porcentaje from bolsillos where empresa_id = $1 order by orden', [empresa.id]);
  return (
    <section className="caja">
      <h2>Bolsillos <small>cómo se reparte cada ingreso; deben sumar 100 %</small></h2>
      <FormAccion action={guardarBolsillos} boton="Guardar reparto" className="lista-config" limpiar={false}>
        {lista.map(b => (
          <div className="mini" key={b.id}>
            <input type="hidden" name="id" value={b.id} />
            <b style={{ width: 40 }}>{b.codigo}</b>
            <input name={`nombre_${b.id}`} defaultValue={b.nombre} style={{ width: 200 }} aria-label="Nombre" />
            <input name={`pct_${b.id}`} defaultValue={b.porcentaje} inputMode="decimal" style={{ width: 80 }} aria-label="Porcentaje" /> %
          </div>))}
      </FormAccion>
      <p className="muted">El cambio aplica a los ingresos que se registren desde ahora; los movimientos anteriores conservan su reparto.</p>
    </section>
  );
}
