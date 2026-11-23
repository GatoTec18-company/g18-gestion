import Link from 'next/link';
import { requerir } from '@/lib/sesion';
import { proyeccion } from '@/lib/proyeccion';
import { cop, fecha } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';
import Acciones from '@/components/ui/Acciones';

const corta = f => fecha(f).slice(0, 5);

function Lista({ items, signo }) {
  return items.map((x, i) => (
    <li key={i}><span className="muted nw">{corta(x.f)}</span>
      <span><Link href={x.href}>{x.texto}</Link> <span className="muted">· {x.tipo}{x.atrasado ? ` · atrasado (era el ${corta(x.original)})` : ''}</span></span>
      <b className={`n ${signo === '+' ? 'pos' : ''}`}>{signo}{cop(x.monto)}</b></li>));
}

export default async function Proyeccion({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'reportes');
  const p = await proyeccion(empresa.id);
  const ultima = p.semanas[p.semanas.length - 1];
  const primeraNegativa = p.semanas.find(s => s.saldoSinVentas < 0);

  return (
    <>
      <Encabezado titulo="¿Me alcanza la plata?" sub={`${empresa.nombre} · próximas 5 semanas (hasta el ${fecha(p.fin)})`}>
        <Acciones />
      </Encabezado>

      <section className="kpis">
        <div className="kpi"><div className="et">Hay hoy (caja + bancos)</div><div className={`va ${p.saldoHoy < 0 ? 'neg' : ''}`}>{cop(p.saldoHoy)}</div></div>
        <div className="kpi"><div className="et">Va a entrar</div><div className="va pos">{cop(p.totalEntra)}</div><div className="de">Addi, Sumas Pay… y saldos de pedidos</div></div>
        <div className="kpi"><div className="et">Hay que pagar</div><div className="va">{cop(p.totalSale)}</div><div className="de">Proveedores, cuotas y gastos fijos</div></div>
        <div className="kpi"><div className="et">Quedaría (sin ventas nuevas)</div><div className={`va ${ultima.saldoSinVentas < 0 ? 'neg' : 'pos'}`}>{cop(ultima.saldoSinVentas)}</div>
          <div className="de">con ventas como las últimas 4 semanas: <b>{cop(ultima.saldoConVentas)}</b></div></div>
      </section>

      {primeraNegativa && (
        <div className="aviso error" style={{ marginBottom: 16 }}>
          ⚠️ Si no entran ventas nuevas, la plata no alcanza en la semana del <b>{corta(primeraNegativa.desde)} al {corta(primeraNegativa.hasta)}</b> (quedaría en {cop(primeraNegativa.saldoSinVentas)}).
          {primeraNegativa.saldoConVentas >= 0 ? ' Con las ventas normales sí alcanza.' : ' Ni siquiera con las ventas normales alcanza: toca mover pagos o conseguir plata.'}
        </div>)}

      <section className="caja">
        <h2>Semana a semana</h2>
        <div className="tabla-cont"><table className="tarjetas">
          <thead><tr><th>Semana</th><th className="n">Entra</th><th className="n">Sale</th><th className="n">Queda sin ventas</th><th className="n">Ventas normales</th><th className="n">Queda con ventas</th></tr></thead>
          <tbody>{p.semanas.map(s => (
            <tr key={s.desde}>
              <td className="t-tit">{corta(s.desde)} al {corta(s.hasta)}</td>
              <td className="n pos" data-label="Entra">{cop(s.entra)}</td>
              <td className="n" data-label="Sale">{cop(s.sale)}</td>
              <td className={`n t-mon ${s.saldoSinVentas < 0 ? 'neg' : ''}`}><b>{cop(s.saldoSinVentas)}</b></td>
              <td className="n muted" data-label="Ventas normales">+{cop(s.ventas)}</td>
              <td className={`n ${s.saldoConVentas < 0 ? 'neg' : ''}`} data-label="Con ventas">{cop(s.saldoConVentas)}</td>
            </tr>))}
          </tbody>
        </table></div>
        <p className="muted">“Ventas normales” es el promedio de lo vendido en los últimos {p.diasPromedio} días ({cop(p.ventaDia)} por día). Es una guía, no una promesa.</p>
      </section>

      {p.semanas.map(s => (s.entradas.length || s.salidas.length) ? (
        <section className="caja" key={s.desde}>
          <h2>{corta(s.desde)} al {corta(s.hasta)} <small>entra {cop(s.entra)} · sale {cop(s.sale)}</small></h2>
          <ul className="lista-proy">
            <Lista items={s.entradas} signo="+" />
            <Lista items={s.salidas} signo="−" />
          </ul>
        </section>) : null)}

      {p.sinFecha.length > 0 && (
        <section className="caja">
          <h2>Sin fecha <small>no se cuentan arriba: ponles fecha para que entren en la proyección</small></h2>
          <ul className="lista-proy">
            {p.sinFecha.map((x, i) => (
              <li key={i}><span className="muted">{x.lado === 'entra' ? 'Entra' : 'Sale'}</span>
                <span><Link href={x.href}>{x.texto}</Link> <span className="muted">· {x.tipo}</span></span>
                <b className="n">{x.lado === 'entra' ? '+' : '−'}{cop(x.monto)}</b></li>))}
          </ul>
        </section>)}
      {!p.semanas.some(s => s.entradas.length || s.salidas.length) && <Vacio>No hay pagos ni cobros con fecha en las próximas semanas.</Vacio>}
    </>
  );
}
