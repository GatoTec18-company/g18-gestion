import Link from 'next/link';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { anularEntreEmpresas, anularPagoPorCobrar, anularPorCobrar, crearPorCobrar, pagarPorCobrar, prestarEntreEmpresas } from '@/servidor/prestamos';

const TIPO = { empleado: 'Empleado', cliente: 'Cliente', otro: 'Otro' };

function Opciones({ lista, empresas, etiqueta }) {
  return empresas.map(e => (
    <optgroup key={e.id} label={e.nombre}>
      {lista.filter(x => x.empresa_id === e.id).map(x => <option key={x.id} value={x.id}>{etiqueta(x)}</option>)}
    </optgroup>));
}

export default async function Prestamos({ searchParams }) {
  const ctx = await requerir(searchParams, 'libro');
  const e = ctx.empresa.id, h = hoyCol();
  const conLibro = ctx.empresasCon('libro');
  const empresas = ctx.empresas.filter(x => conLibro.includes(x.id));
  const dos = empresas.length >= 2;
  const [cuentas, bolsillos, entre, deudas, pagos] = await Promise.all([
    sql(`select id, empresa_id, nombre, tipo from cuentas where empresa_id = any($1) and activa order by (tipo = 'efectivo') desc, nombre`, [conLibro]),
    sql(`select id, empresa_id, codigo, nombre from bolsillos where empresa_id = any($1) order by orden`, [conLibro]),
    dos ? sql(`select p.*, d.nombre de_nombre, a.nombre a_nombre from prestamos_empresas p join empresas d on d.id = p.de_empresa join empresas a on a.id = p.a_empresa
               where p.de_empresa = any($1) and p.a_empresa = any($1) order by p.fecha desc, p.creado_en desc`, [conLibro]) : [],
    sql(`select * from v_por_cobrar where empresa_id = $1 order by (saldo > 0) desc, fecha_esperada nulls last, fecha desc`, [e]),
    sql(`select p.* from por_cobrar_pagos p join por_cobrar c on c.id = p.por_cobrar_id where c.empresa_id = $1 order by p.fecha`, [e]),
  ]);
  const cuentasActiva = cuentas.filter(c => c.empresa_id === e), bolsillosActiva = bolsillos.filter(b => b.empresa_id === e);
  // Saldo entre empresas: lo que la empresa A le ha pasado a B menos lo que B le ha pasado a A
  const [A, B] = empresas;
  const neto = dos ? entre.reduce((s, p) => s + (p.de_empresa === A.id ? p.monto : -p.monto), 0) : 0;
  const abiertas = deudas.filter(d => d.saldo > 0), cerradas = deudas.filter(d => d.saldo <= 0);
  const totalDeben = abiertas.reduce((s, d) => s + d.saldo, 0);

  return (
    <>
      <Encabezado titulo="Préstamos" sub="Plata que se pasan las empresas y plata que nos deben personas. No cuenta como venta ni como gasto." />

      {dos && (
        <section className="caja">
          <h2>Entre {A.nombre} y {B.nombre}</h2>
          <div className={`aviso ${Math.abs(neto) < 1 ? 'ok' : 'error'}`} style={{ marginBottom: 14, fontSize: 15 }}>
            {Math.abs(neto) < 1 ? 'Están a paz y salvo.' : <><b>{neto > 0 ? B.nombre : A.nombre}</b> le debe a <b>{neto > 0 ? A.nombre : B.nombre}</b> <b>{cop(Math.abs(neto))}</b></>}
          </div>
          <details open={entre.length === 0}>
            <summary className="btn-sec" style={{ display: 'inline-block' }}>+ Registrar plata que pasa de una empresa a la otra</summary>
            <FormAccion action={prestarEntreEmpresas} boton="Registrar en las dos empresas">
              <label>Fecha<input type="date" name="fecha" defaultValue={h} required /></label>
              <label>Monto<input name="monto" inputMode="numeric" required placeholder="0" /></label>
              <label>Sale de<select name="de_empresa" defaultValue={e}>{empresas.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
              <label>Entra a<select name="a_empresa" defaultValue={empresas.find(x => x.id !== e)?.id}>{empresas.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
              <label>Cuenta de donde sale<select name="cuenta_sale" required defaultValue={cuentas.find(c => c.empresa_id === e)?.id}><Opciones lista={cuentas} empresas={empresas} etiqueta={c => c.nombre} /></select></label>
              <label>Bolsillo de donde sale<select name="bolsillo_sale" required defaultValue=""><option value="" disabled>Elegir…</option><Opciones lista={bolsillos} empresas={empresas} etiqueta={b => `${b.codigo} · ${b.nombre}`} /></select></label>
              <label>Cuenta a donde entra<select name="cuenta_entra" required defaultValue={cuentas.find(c => c.empresa_id !== e)?.id}><Opciones lista={cuentas} empresas={empresas} etiqueta={c => c.nombre} /></select></label>
              <label>Bolsillo a donde entra<select name="bolsillo_entra" defaultValue=""><option value="">Repartir 75/10/10/5</option><Opciones lista={bolsillos} empresas={empresas} etiqueta={b => `${b.codigo} · ${b.nombre}`} /></select></label>
              <label className="ancho">Motivo<input name="concepto" placeholder="Ej. préstamo para pagar a Amazon / devolución del préstamo" required /></label>
            </FormAccion>
            <p className="muted">Elige la cuenta y el bolsillo de la empresa correcta en cada lado. Si una empresa le devuelve a la otra, regístralo igual, al revés.</p>
          </details>
          {entre.length > 0 && (
            <div className="tabla-cont" style={{ marginTop: 12 }}><table className="tarjetas">
              <thead><tr><th>Fecha</th><th>De → a</th><th>Motivo</th><th className="n">Monto</th><th /></tr></thead>
              <tbody>{entre.map(p => (
                <tr key={p.id}>
                  <td data-label="📅">{fecha(p.fecha)}</td>
                  <td className="t-tit">{p.de_nombre} → {p.a_nombre}</td>
                  <td className="t-linea">{p.concepto}</td>
                  <td className="n t-mon">{cop(p.monto)}</td>
                  <td className="t-acc"><FormAccion action={anularEntreEmpresas} boton="Anular" className="mini" limpiar={false} confirmar={`¿Anular este registro de ${cop(p.monto)}? Se borra en las dos empresas.`}>
                    <input type="hidden" name="id" value={p.id} /></FormAccion></td>
                </tr>))}
              </tbody>
            </table></div>)}
        </section>)}

      <section className="caja">
        <h2>Nos deben <small>{ctx.empresa.nombre} · anticipos, préstamos a personas, crédito directo</small></h2>
        <div className="kpis" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))' }}>
          <div className="kpi"><div className="et">Total que nos deben</div><div className="va neg">{cop(totalDeben)}</div><div className="de">{abiertas.length} pendiente(s)</div></div>
        </div>
        <details open={deudas.length === 0}>
          <summary className="btn-sec" style={{ display: 'inline-block' }}>+ Registrar plata que alguien nos debe</summary>
          <FormAccion action={crearPorCobrar} boton="Registrar">
            <label>Quién<input name="persona" required placeholder="Nombre" /></label>
            <label>Es<select name="tipo" defaultValue="empleado">{Object.entries(TIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
            <label>Monto<input name="monto" inputMode="numeric" required placeholder="0" /></label>
            <label>Fecha<input type="date" name="fecha" defaultValue={h} required /></label>
            <label>Paga más o menos el<input type="date" name="fecha_esperada" /></label>
            <label className="ancho">Por qué<input name="concepto" required placeholder="Ej. anticipo de sueldo, préstamo, equipo a crédito" /></label>
            <label className="casilla ancho"><input type="checkbox" name="sale_caja" defaultChecked /> <span>La plata salió de la caja ahora <small>Se registra la salida en el libro (sin contar como gasto). Desmárcalo si es una deuda vieja o si no salió plata.</small></span></label>
            <label>Sale de<select name="cuenta_id">{cuentasActiva.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
            <label>Bolsillo<select name="bolsillo_id" defaultValue=""><option value="">Elegir…</option>{bolsillosActiva.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select></label>
          </FormAccion>
        </details>

        {abiertas.length === 0 ? <Vacio>Nadie nos debe por ahora.</Vacio> : (
          <div className="tarjetas-venta" style={{ marginTop: 12 }}>
            {abiertas.map(d => {
              const vencida = d.fecha_esperada && d.fecha_esperada < h;
              const suyos = pagos.filter(p => p.por_cobrar_id === d.id);
              return (
                <article className="tarjeta-venta" key={d.id}>
                  <div className="tv-cab">
                    <div><b>{d.persona}</b> <span className="muted">· {TIPO[d.tipo]}</span><div className="muted">{d.concepto}</div></div>
                    <div style={{ textAlign: 'right' }}><b className="neg">{cop(d.saldo)}</b><div className="muted">de {cop(d.monto)}</div></div>
                  </div>
                  <div className="tv-datos">
                    <span>Desde el {fecha(d.fecha)}{d.fecha_esperada && <> · paga el <b className={vencida ? 'neg' : ''}>{fecha(d.fecha_esperada)}</b>{vencida ? ' (vencido)' : ''}</>}</span>
                    {suyos.map(p => (
                      <div key={p.id} className="mini"><span className="muted">Pagó {cop(p.monto)} el {fecha(p.fecha)}{p.nota ? ` · ${p.nota}` : ''}</span>
                        <FormAccion action={anularPagoPorCobrar} boton="Anular pago" className="mini" limpiar={false} confirmar="¿Anular este pago?"><input type="hidden" name="id" value={p.id} /></FormAccion></div>))}
                  </div>
                  <div className="tv-acciones">
                    <FormAccion action={pagarPorCobrar} boton="Registrar pago" className="mini">
                      <input type="hidden" name="por_cobrar_id" value={d.id} />
                      <input type="date" name="fecha" defaultValue={h} required aria-label="Fecha del pago" />
                      <input name="monto" defaultValue={d.saldo} inputMode="numeric" required aria-label="Monto" style={{ width: 120 }} />
                      <select name="cuenta_id" aria-label="Cuenta">{cuentasActiva.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>
                      <select name="bolsillo_id" aria-label="Bolsillo" defaultValue=""><option value="">Repartir 75/10/10/5</option>{bolsillosActiva.map(b => <option key={b.id} value={b.id}>{b.codigo}</option>)}</select>
                      <label className="casilla" style={{ flexDirection: 'row' }}><input type="checkbox" name="entra_caja" defaultChecked /> <span>Entra a la caja</span></label>
                      <input name="nota" placeholder="Nota (ej. descontado de nómina)" style={{ width: 200 }} />
                    </FormAccion>
                    <FormAccion action={anularPorCobrar} boton="Anular todo" className="mini" limpiar={false} confirmar={`¿Anular lo que debe ${d.persona}? También se borran sus pagos y los movimientos del libro.`}>
                      <input type="hidden" name="id" value={d.id} /></FormAccion>
                  </div>
                </article>);
            })}
          </div>)}

        {cerradas.length > 0 && (
          <details style={{ marginTop: 12 }}><summary>Ya pagaron ({cerradas.length})</summary>
            <div className="tabla-cont"><table className="tarjetas">
              <thead><tr><th>Quién</th><th>Por qué</th><th className="n">Monto</th><th>Último pago</th></tr></thead>
              <tbody>{cerradas.map(d => <tr key={d.id}><td className="t-tit">{d.persona}</td><td className="t-linea">{d.concepto}</td><td className="n t-mon">{cop(d.monto)}</td><td data-label="Pagó">{fecha(d.ultimo_pago)}</td></tr>)}</tbody>
            </table></div>
          </details>)}
        <p className="muted">Si la plata salió o entró de la caja, queda en el <Link href="/libro">Libro diario</Link> en “Otros movimientos” y mueve el bolsillo, pero no cuenta como venta ni como gasto.</p>
      </section>
    </>
  );
}
