import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Chip, Encabezado, SelectorMes, Vacio } from '@/components/ui/Comunes';

export default async function GastosFijos({ searchParams }) {
  const ctx = await requerir(searchParams, 'gastos_fijos');
  const { empresa, mes, mesInicio } = ctx;
  const [filas, porEmpresa, info] = await Promise.all([
    sql(`select * from gastos_fijos_mes($1, $2) order by fecha_limite nulls last, concepto`, [empresa.id, mesInicio]),
    // Desde qué empresa se pagó cada gasto este mes
    sql(`select m.gasto_fijo_id, e.nombre, sum(m.monto) monto from movimientos m join empresas e on e.id = m.empresa_id
         where m.tipo = 'egreso' and m.gasto_fijo_id is not null and date_trunc('month', m.fecha) = $1::date group by 1, 2 order by 2`, [mesInicio]),
    sql(`select id, compartido from gastos_fijos`),
  ]);
  const compartido = id => info.find(x => x.id === id)?.compartido;
  const pagosDe = id => porEmpresa.filter(x => x.gasto_fijo_id === id);
  const corto = n => n.split(' ')[0];
  const totalPor = Object.entries(porEmpresa.filter(x => filas.some(f => f.gasto_fijo_id === x.gasto_fijo_id))
    .reduce((a, x) => ({ ...a, [x.nombre]: (a[x.nombre] ?? 0) + x.monto }), {}));
  const t = k => filas.reduce((s, f) => s + f[k], 0);
  const n = est => filas.filter(f => f.estado === est).length;

  return (
    <>
      <Encabezado titulo="Gastos fijos" sub={`${nombreMes(mes)} · los compartidos se pagan desde la empresa que tenga la plata`}>
        <SelectorMes mes={mes} ruta="/gastos-fijos" />
      </Encabezado>
      <section className="kpis">
        <div className="kpi"><div className="et">Previsto del mes</div><div className="va">{cop(t('previsto'))}</div></div>
        <div className="kpi"><div className="et">Pagado</div><div className="va">{cop(t('pagado'))}</div>
          {totalPor.length > 0 && <div className="de">{totalPor.map(([n, v]) => `${corto(n)} ${cop(v)}`).join(' · ')}</div>}
          <div className="barra"><div style={{ width: `${t('previsto') ? Math.min(100, (t('pagado') / t('previsto')) * 100) : 0}%` }} /></div></div>
        <div className="kpi"><div className="et">Falta por pagar</div><div className="va">{cop(filas.reduce((s, f) => s + Math.max(f.diferencia, 0), 0))}</div></div>
        <div className="kpi"><div className="et">Estado</div><div className="va">{n('Vencido')} <span className="muted">vencidos</span></div>
          <div className="de">{n('Pagado')} pagados · {n('Parcial')} parciales · {n('Pendiente')} pendientes</div></div>
      </section>
      <section className="caja">
        {filas.length === 0 ? <Vacio>Esta empresa no tiene gastos fijos configurados.</Vacio> : (
          <div className="tabla-cont"><table className="tarjetas">
            <thead><tr><th>Concepto</th><th>Fecha límite</th><th className="n">Previsto</th><th className="n">Pagado</th><th className="n">Diferencia</th><th>Estado</th></tr></thead>
            <tbody>{filas.map(f => (
              <tr key={f.gasto_fijo_id}>
                <td className="t-tit"><b>{f.concepto}</b>{compartido(f.gasto_fijo_id) && <span className="muted"> · compartido</span>}</td>
                <td data-label="Límite">{f.fecha_limite ? fecha(f.fecha_limite) : <span className="muted">sin fecha</span>}</td>
                <td className="n t-mon">{cop(f.previsto)}</td><td className="n" data-label="Pagado">{cop(f.pagado)}{pagosDe(f.gasto_fijo_id).length > 1 || (pagosDe(f.gasto_fijo_id)[0] && pagosDe(f.gasto_fijo_id)[0].nombre !== empresa.nombre)
                  ? <div className="muted">{pagosDe(f.gasto_fijo_id).map(x => `${corto(x.nombre)} ${cop(x.monto)}`).join(' · ')}</div> : null}</td>
                <td className={`n ${f.diferencia < 0 ? 'pos' : ''}`} data-label="Falta">{cop(f.diferencia)}</td>
                <td><Chip>{f.estado}</Chip></td>
              </tr>))}
            </tbody>
            <tfoot><tr><td className="t-tit">Total</td><td /><td className="n t-mon">{cop(t('previsto'))}</td><td className="n" data-label="Pagado">{cop(t('pagado'))}</td><td className="n" data-label="Falta">{cop(t('diferencia'))}</td><td /></tr></tfoot>
          </table></div>
        )}
        <p className="muted">Para que un pago cuente aquí, en el Libro diario elige el gasto fijo al registrar el egreso, desde la empresa que pagó.
          Los gastos <b>compartidos</b> salen en las dos empresas y quedan pagados sin importar desde cuál se pagaron.</p>
      </section>
    </>
  );
}
