import { requerir } from '@/lib/sesion';
import { flujoPorMes, GRUPOS } from '@/lib/reportes';
import { cop, mesVecino, nombreMes } from '@/lib/formato';
import { Encabezado, SelectorMes } from '@/components/ui/Comunes';
import Acciones from '@/components/ui/Acciones';

const COLORES = ['#7b3f94', '#b07cc6', '#c0392b', '#1d5fa8', '#1f7a4d', '#8a5a00', '#5d5866', '#2c8c99', '#a0a0a0', '#d0d0d0'];
const DESTINO = { mercancia: 'Mercancía para vender', pedido_cliente: 'Pedidos de clientes', activos: 'Equipos / activos', otro: 'Otro' };
const corto = m => nombreMes(m).replace(/ \d{4}$/, '').slice(0, 3);

export default async function Reportes({ searchParams }) {
  const { empresa, mes } = await requerir(searchParams, 'reportes');
  const desde = mesVecino(mes, -5);
  const filas = await flujoPorMes(empresa.id, desde, mes);
  const actual = filas[filas.length - 1];
  const gruposConDatos = GRUPOS.filter(g => filas.some(f => f.porGrupo[g]));
  const maxBarra = Math.max(1, ...gruposConDatos.map(g => actual.porGrupo[g]));

  return (
    <>
      <Encabezado titulo="¿A dónde se fue la plata?" sub={`${empresa.nombre} · ${nombreMes(mes)} y los 5 meses anteriores`}>
        <SelectorMes mes={mes} ruta="/reportes" />
        <Acciones excel={`/api/exportar?tipo=reporte&mes=${mes}`} />
      </Encabezado>

      <section className="kpis">
        <div className="kpi"><div className="et">Entró (ventas)</div><div className="va">{cop(actual.ventas)}</div>
          <div className="de">Efectivo {cop(actual.ventasEfectivo)} · Cuentas {cop(actual.ventasBanco)}</div></div>
        <div className="kpi"><div className="et">Salió (egresos)</div><div className="va">{cop(actual.egresos)}</div></div>
        <div className="kpi"><div className="et">Diferencia</div><div className={`va ${actual.flujo < 0 ? 'neg' : 'pos'}`}>{cop(actual.flujo)}</div></div>
        <div className="kpi"><div className="et">Mercancía nueva</div><div className="va">{cop(actual.porGrupo['Mercancía nueva'] + (actual.comprasCredito.mercancia ?? 0))}</div>
          <div className="de">pagada {cop(actual.porGrupo['Mercancía nueva'])} · a crédito {cop(actual.comprasCredito.mercancia ?? 0)}</div></div>
      </section>

      <div className="dos">
        <section className="caja">
          <h2>Salidas de {nombreMes(mes)}</h2>
          {gruposConDatos.length === 0 ? <p className="vacio">Sin egresos este mes.</p> : (
            <div className="barras-h">
              {GRUPOS.filter(g => actual.porGrupo[g]).sort((a, b) => actual.porGrupo[b] - actual.porGrupo[a]).map(g => (
                <div key={g} className="barra-h">
                  <span className="et">{g}</span>
                  <div className="pista"><div style={{ width: `${(actual.porGrupo[g] / maxBarra) * 100}%`, background: COLORES[GRUPOS.indexOf(g)] }} /></div>
                  <span className="n">{cop(actual.porGrupo[g])}</span>
                  <span className="muted n">{actual.egresos ? Math.round(actual.porGrupo[g] / actual.egresos * 100) : 0} %</span>
                </div>))}
            </div>)}
          <p className="muted">Los pagos ligados a un crédito cuentan en “Bancos y créditos”. La mercancía y los pedidos salen de la categoría del egreso.</p>
        </section>
        <section className="caja">
          <h2>Compras a crédito de {nombreMes(mes)} <small>aún no salen de la caja</small></h2>
          {Object.keys(actual.comprasCredito).length === 0 ? <p className="vacio">Sin compras a crédito registradas este mes.</p> : (
            <div className="tabla-cont"><table><tbody>
              {Object.entries(actual.comprasCredito).map(([d, v]) => <tr key={d}><td>{DESTINO[d] ?? d}</td><td className="n">{cop(v)}</td></tr>)}
            </tbody></table></div>)}
          <p className="muted">Sale de las facturas de proveedores y de lo que se compró con tarjetas o créditos.</p>
        </section>
      </div>

      <section className="caja">
        <h2>Mes a mes</h2>
        <div className="tabla-cont"><table>
          <thead><tr><th />{filas.map(f => <th key={f.mes} className="n">{corto(f.mes)}</th>)}</tr></thead>
          <tbody>
            <tr className="fila-total"><td><b>Ventas</b></td>{filas.map(f => <td key={f.mes} className="n pos"><b>{cop(f.ventas)}</b></td>)}</tr>
            {gruposConDatos.map(g => (
              <tr key={g}><td>{g}</td>{filas.map(f => <td key={f.mes} className="n">{f.porGrupo[g] ? cop(f.porGrupo[g]) : <span className="muted">—</span>}</td>)}</tr>))}
            <tr className="fila-total"><td><b>Total egresos</b></td>{filas.map(f => <td key={f.mes} className="n"><b>{cop(f.egresos)}</b></td>)}</tr>
            <tr><td><b>Diferencia</b></td>{filas.map(f => <td key={f.mes} className={`n ${f.flujo < 0 ? 'neg' : 'pos'}`}><b>{cop(f.flujo)}</b></td>)}</tr>
          </tbody>
        </table></div>
      </section>
    </>
  );
}
