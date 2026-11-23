import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Chip, Encabezado, SelectorMes, Vacio } from '@/components/ui/Comunes';

export default async function GastosFijos({ searchParams }) {
  const { empresa, mes, mesInicio } = await requerir(searchParams, 'gastos_fijos');
  const filas = await sql(`select * from gastos_fijos_mes($1, $2) order by fecha_limite nulls last, concepto`, [empresa.id, mesInicio]);
  const t = k => filas.reduce((s, f) => s + f[k], 0);
  const n = est => filas.filter(f => f.estado === est).length;

  return (
    <>
      <Encabezado titulo="Gastos fijos" sub={`${empresa.nombre} · ${nombreMes(mes)}`}>
        <SelectorMes mes={mes} ruta="/gastos-fijos" />
      </Encabezado>
      <section className="kpis">
        <div className="kpi"><div className="et">Previsto del mes</div><div className="va">{cop(t('previsto'))}</div></div>
        <div className="kpi"><div className="et">Pagado</div><div className="va">{cop(t('pagado'))}</div>
          <div className="barra"><div style={{ width: `${t('previsto') ? Math.min(100, (t('pagado') / t('previsto')) * 100) : 0}%` }} /></div></div>
        <div className="kpi"><div className="et">Falta por pagar</div><div className="va">{cop(filas.reduce((s, f) => s + Math.max(f.diferencia, 0), 0))}</div></div>
        <div className="kpi"><div className="et">Estado</div><div className="va">{n('Vencido')} <span className="muted">vencidos</span></div>
          <div className="de">{n('Pagado')} pagados · {n('Parcial')} parciales · {n('Pendiente')} pendientes</div></div>
      </section>
      <section className="caja">
        {filas.length === 0 ? <Vacio>Esta empresa no tiene gastos fijos configurados.</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Concepto</th><th>Fecha límite</th><th className="n">Previsto</th><th className="n">Pagado</th><th className="n">Diferencia</th><th>Estado</th></tr></thead>
            <tbody>{filas.map(f => (
              <tr key={f.gasto_fijo_id}>
                <td><b>{f.concepto}</b></td>
                <td>{f.fecha_limite ? fecha(f.fecha_limite) : <span className="muted">sin fecha</span>}</td>
                <td className="n">{cop(f.previsto)}</td><td className="n">{cop(f.pagado)}</td>
                <td className={`n ${f.diferencia < 0 ? 'pos' : ''}`}>{cop(f.diferencia)}</td>
                <td><Chip>{f.estado}</Chip></td>
              </tr>))}
            </tbody>
            <tfoot><tr><td>Total</td><td /><td className="n">{cop(t('previsto'))}</td><td className="n">{cop(t('pagado'))}</td><td className="n">{cop(t('diferencia'))}</td><td /></tr></tfoot>
          </table></div>
        )}
        <p className="muted">Para que un pago cuente aquí, en el Libro diario elige el gasto fijo al registrar el egreso.</p>
      </section>
    </>
  );
}
