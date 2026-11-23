import Link from 'next/link';
import Acciones from '@/components/ui/Acciones';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { cop, fecha, nombreMes } from '@/lib/formato';
import { Encabezado, Vacio } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import { agregarCargo, anularCargo, guardarCredito } from '@/servidor/creditos';

const TIPO = { credito: 'Crédito', tarjeta: 'Tarjeta de crédito', prestamo: 'Préstamo', otro: 'Otro' };
const DESTINO = { mercancia: 'Mercancía para vender', pedido_cliente: 'Pedido de cliente', activos: 'Equipos / activos', otro: 'Otro' };

function CamposCredito({ c = {} }) {
  return <>
    <label>Banco o entidad<input name="entidad" defaultValue={c.entidad ?? ''} required placeholder="Ej. Banco Agrario" /></label>
    <label>Tipo<select name="tipo" defaultValue={c.tipo ?? 'credito'}>{Object.entries(TIPO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
    <label>Descripción<input name="descripcion" defaultValue={c.descripcion ?? ''} placeholder="Ej. Crédito de libre inversión" /></label>
    <label>Lo que se debía<input name="saldo_inicial" defaultValue={c.saldo_inicial ?? ''} inputMode="numeric" required /></label>
    <label>A la fecha<input type="date" name="fecha_inicial" defaultValue={c.fecha_inicial ?? ''} required /></label>
    <label>Cuota mensual<input name="cuota" defaultValue={c.cuota ?? ''} inputMode="numeric" /></label>
    <label>Día de pago<input name="dia_pago" defaultValue={c.dia_pago ?? ''} inputMode="numeric" /></label>
  </>;
}

export default async function Creditos({ searchParams }) {
  const { empresa, mes, mesInicio } = await requerir(searchParams, 'creditos');
  const e = empresa.id;
  const hoy = hoyCol();
  const [creditos, pagosMes, cargos, pagos] = await Promise.all([
    sql(`select * from v_creditos where empresa_id = $1 order by activo desc, saldo desc`, [e]),
    sql(`select credito_id, sum(monto) pagado from movimientos where empresa_id = $1 and credito_id is not null and tipo = 'egreso'
         and date_trunc('month', fecha) = $2::date group by 1`, [e, mesInicio]),
    sql(`select g.*, cr.entidad from credito_cargos g join creditos cr on cr.id = g.credito_id where cr.empresa_id = $1 order by g.fecha desc limit 40`, [e]),
    sql(`select m.id, m.fecha, m.concepto, m.monto, cr.entidad from movimientos m join creditos cr on cr.id = m.credito_id
         where m.empresa_id = $1 and m.tipo = 'egreso' order by m.fecha desc limit 40`, [e]),
  ]);
  const pagadoMes = id => pagosMes.find(p => p.credito_id === id)?.pagado ?? 0;
  const activos = creditos.filter(c => c.activo);
  const deuda = activos.reduce((s, c) => s + Math.max(0, c.saldo), 0);
  const cuotas = activos.reduce((s, c) => s + (c.cuota ?? 0), 0);
  const pagadoEsteMes = pagosMes.reduce((s, p) => s + p.pagado, 0);

  return (
    <>
      <Encabezado titulo="Créditos y bancos" sub={`${empresa.nombre} · lo que se debe a bancos, tarjetas y préstamos`}>
        <Acciones excel="/api/exportar?tipo=creditos" />
      </Encabezado>

      <section className="kpis">
        <div className="kpi"><div className="et">Deuda con bancos</div><div className={`va ${deuda > 0 ? 'neg' : ''}`}>{cop(deuda)}</div>
          <div className="de">{activos.length} créditos activos</div></div>
        <div className="kpi"><div className="et">Cuotas al mes</div><div className="va">{cop(cuotas)}</div></div>
        <div className="kpi"><div className="et">Pagado en {nombreMes(mes)}</div><div className="va">{cop(pagadoEsteMes)}</div>
          <div className="barra"><div style={{ width: `${cuotas ? Math.min(100, (pagadoEsteMes / cuotas) * 100) : 0}%` }} /></div></div>
      </section>

      <section className="caja">
        <h2>Créditos</h2>
        {creditos.length === 0 ? <Vacio>Todavía no hay créditos registrados. Agrega abajo el primero (por ejemplo, el del Banco Agrario).</Vacio> : (
          <div className="tabla-cont"><table>
            <thead><tr><th>Entidad</th><th>Tipo</th><th className="n">Debía</th><th className="n">+ Cargos</th><th className="n">− Pagado</th>
              <th className="n">Saldo</th><th className="n">Cuota</th><th>Paga el</th><th className="n">Pagado este mes</th></tr></thead>
            <tbody>{creditos.map(c => {
              const pm = pagadoMes(c.id);
              const venceDia = c.dia_pago ? `${mes}-${String(Math.min(c.dia_pago, 28)).padStart(2, '0')}` : null;
              return (
                <tr key={c.id} className={c.activo ? '' : 'muted'}>
                  <td><b>{c.entidad}</b>{c.descripcion && <div className="muted">{c.descripcion}</div>}</td>
                  <td>{TIPO[c.tipo]}</td>
                  <td className="n">{cop(c.saldo_inicial)}<div className="muted">{fecha(c.fecha_inicial)}</div></td>
                  <td className="n">{cop(c.cargos)}</td><td className="n">{cop(c.pagado)}</td>
                  <td className={`n ${c.saldo > 0 ? 'neg' : ''}`}><b>{cop(c.saldo)}</b></td>
                  <td className="n">{cop(c.cuota)}</td>
                  <td>{c.dia_pago ? `día ${c.dia_pago}` : '—'}</td>
                  <td className="n">{cop(pm)}{c.cuota > 0 && c.activo && (pm >= c.cuota ? <div className="pos">al día</div>
                    : venceDia && venceDia < hoy ? <div className="neg">pendiente</div> : <div className="muted">por pagar</div>)}</td>
                </tr>);
            })}</tbody>
          </table></div>)}
        <p className="muted">Los <b>pagos</b> se registran en el Libro diario como egreso (categoría “Deuda y financieros”), eligiendo el crédito en “Proveedor, gasto fijo o crédito”. El saldo baja solo.</p>
      </section>

      <div className="dos">
        <section className="caja">
          <h2>Registrar crédito o deuda</h2>
          <FormAccion action={guardarCredito} boton="Registrar"><CamposCredito c={{ fecha_inicial: `${mes}-01` }} /></FormAccion>
          {creditos.length > 0 && <details style={{ marginTop: 12 }}><summary>Corregir un crédito</summary>
            {creditos.map(c => (
              <FormAccion key={c.id} action={guardarCredito} boton="Guardar" limpiar={false}>
                <input type="hidden" name="id" value={c.id} /><CamposCredito c={c} />
                <label className="casilla"><input type="checkbox" name="activo" defaultChecked={c.activo} /> <span>Activo<small>Desactívalo cuando quede pagado.</small></span></label>
              </FormAccion>))}
          </details>}
        </section>
        <section className="caja">
          <h2>Aumentó la deuda</h2>
          <p className="muted" style={{ marginTop: 0 }}>Compras con la tarjeta de crédito, un nuevo desembolso o intereses cobrados.</p>
          {creditos.length === 0 ? <Vacio>Primero registra un crédito.</Vacio> : (
            <FormAccion action={agregarCargo} boton="Registrar">
              <label>Crédito<select name="credito_id" required>{activos.map(c => <option key={c.id} value={c.id}>{c.entidad}{c.descripcion ? ` · ${c.descripcion}` : ''}</option>)}</select></label>
              <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
              <label>Valor<input name="monto" inputMode="numeric" required /></label>
              <label>¿Para qué fue?<select name="destino" defaultValue="mercancia">{Object.entries(DESTINO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></label>
              <label className="ancho">Concepto<input name="concepto" required placeholder="Ej. Compra de 3 portátiles con la tarjeta" /></label>
            </FormAccion>)}
        </section>
      </div>

      <div className="dos">
        <section className="caja">
          <h2>Últimos pagos a créditos</h2>
          {pagos.length === 0 ? <Vacio>Sin pagos ligados a créditos.</Vacio> : (
            <div className="tabla-cont"><table>
              <thead><tr><th>Fecha</th><th>Crédito</th><th>Concepto</th><th className="n">Monto</th></tr></thead>
              <tbody>{pagos.map(p => (
                <tr key={p.id}><td>{fecha(p.fecha)}</td><td>{p.entidad}</td><td><Link href={`/libro/movimiento/${p.id}`} className="link-editar">{p.concepto}</Link></td><td className="n">{cop(p.monto)}</td></tr>))}
              </tbody>
            </table></div>)}
        </section>
        <section className="caja">
          <h2>Últimos aumentos de deuda</h2>
          {cargos.length === 0 ? <Vacio>Sin aumentos registrados.</Vacio> : (
            <div className="tabla-cont"><table>
              <thead><tr><th>Fecha</th><th>Crédito</th><th>Concepto</th><th className="n">Valor</th><th /></tr></thead>
              <tbody>{cargos.map(g => (
                <tr key={g.id}><td>{fecha(g.fecha)}</td><td>{g.entidad}</td><td>{g.concepto}<div className="muted">{DESTINO[g.destino]}</div></td><td className="n">{cop(g.monto)}</td>
                  <td><FormAccion action={anularCargo} boton="Anular" className="mini" limpiar={false} confirmar="¿Anular este registro?">
                    <input type="hidden" name="cargo_id" value={g.id} /></FormAccion></td></tr>))}
              </tbody>
            </table></div>)}
        </section>
      </div>
    </>
  );
}
