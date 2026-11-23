import Link from 'next/link';
import { redirect } from 'next/navigation';
import { sql } from '@/lib/db';
import { contexto } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { registrarCuadre } from '@/servidor/cuadre';

export default async function Cuadre({ searchParams }) {
  const ctx = await contexto(searchParams);
  const veLibro = ctx.puede('libro');
  if (!veLibro && !ctx.puede('cuadre')) redirect('/sin-permiso');
  const e = ctx.empresa.id, h = hoyCol();
  // La diferencia se calcula con el libro de HOY (si después se corrige el libro, el cuadre se actualiza)
  const lista = await sql(`
    select q.id, q.fecha, q.saldo_contado contado, q.nota, q.creado_en, coalesce(u.nombre, '—') quien,
      (select coalesce(sum(case m.tipo when 'ingreso' then m.monto else -m.monto end), 0) from movimientos m where m.cuenta_id = q.cuenta_id and m.fecha <= q.fecha) libro
    from cuadres_caja q join cuentas c on c.id = q.cuenta_id and c.tipo = 'efectivo'
    left join lateral (select nombre from miembros where user_id = q.hecho_por limit 1) u on true
    where q.empresa_id = $1 ${veLibro ? '' : 'and q.hecho_por = $2'}
    order by q.fecha desc, q.creado_en desc limit 40`, veLibro ? [e] : [e, ctx.usuario.id]);
  const hoyHecho = lista.find(x => x.fecha === h && !(x.nota ?? '').startsWith('Cierre'));
  const conDif = lista.filter(x => Math.abs(x.contado - x.libro) >= 1000);

  return (
    <>
      <Encabezado titulo="Cuadre de caja" sub={`${ctx.empresa.nombre} · contar el efectivo al final del día`} />
      <div className="dos">
        <section className="caja">
          <h2>{hoyHecho ? 'Volver a cuadrar' : 'Cuadrar la caja'}</h2>
          {veLibro && <p className="muted" style={{ marginTop: 0 }}>Primero registra las ventas y gastos del día en el <Link href="/libro">Libro diario</Link>; si no, la diferencia saldrá mal.</p>}
          {!veLibro && <p className="muted" style={{ marginTop: 0 }}>Cuenta todos los billetes y monedas de la caja y escribe el total. No necesitas saber cuánto debería haber.</p>}
          <FormAccion action={registrarCuadre} boton="Guardar cuadre">
            <label>Día<input type="date" name="fecha" defaultValue={h} max={h} required /></label>
            <label>💵 Efectivo contado<input name="contado" inputMode="numeric" required placeholder="0" /></label>
            <label className="ancho">Nota (opcional)<input name="nota" placeholder="Ej. se sacó plata para un domicilio" /></label>
          </FormAccion>
          {hoyHecho && <p className="muted">Hoy ya se cuadró a las {new Date(hoyHecho.creado_en).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit' })}. Si lo vuelves a hacer, reemplaza el anterior.</p>}
        </section>
        {veLibro && (
          <section className="caja">
            <h2>Cómo va</h2>
            <div className="kpis" style={{ gridTemplateColumns: '1fr 1fr' }}>
              <div className="kpi"><div className="et">Cuadres guardados</div><div className="va">{lista.length}</div></div>
              <div className={`kpi`}><div className="et">Con diferencia</div><div className={`va ${conDif.length ? 'neg' : 'pos'}`}>{conDif.length}</div>
                <div className="de">{conDif.length ? `suman ${cop(conDif.reduce((s, x) => s + x.contado - x.libro, 0))}` : 'todo cuadra'}</div></div>
            </div>
            <p className="muted">Se considera que cuadra si la diferencia es menor a $1.000.</p>
          </section>)}
      </div>

      <section className="caja">
        <h2>Últimos cuadres</h2>
        {lista.length === 0 ? <Vacio>Todavía no hay cuadres.</Vacio> : (
          <div className="tabla-cont"><table className="tarjetas">
            <thead><tr><th>Día</th><th>Quién</th><th className="n">Contado</th>{veLibro && <><th className="n">Según libro</th><th className="n">Diferencia</th></>}<th>Nota</th></tr></thead>
            <tbody>{lista.map(x => {
              const d = x.contado - x.libro;
              return (
                <tr key={x.id}>
                  <td className="t-tit">{fecha(x.fecha)}</td>
                  <td data-label="Contó">{x.quien}</td>
                  <td className="n" data-label="Contado">{cop(x.contado)}</td>
                  {veLibro && <><td className="n" data-label="Libro">{cop(x.libro)}</td>
                    <td className={`n t-mon ${Math.abs(d) >= 1000 ? 'neg' : 'pos'}`}>{Math.abs(d) < 1000 ? '✓ cuadra' : `${d < 0 ? 'falta ' : 'sobra '}${cop(Math.abs(d))}`}</td></>}
                  <td className="muted t-linea">{x.nota ?? ''}</td>
                </tr>);
            })}</tbody>
          </table></div>)}
      </section>
    </>
  );
}
