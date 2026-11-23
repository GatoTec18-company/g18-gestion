'use client';
import { useEffect, useRef } from 'react';
import { crearMovimiento } from '@/servidor/libro';
import useEnvio from './useEnvio';
import { comprimirCampo } from '@/lib/comprimir';

const prepararFoto = fd => comprimirCampo(fd, 'comprobante');

// Egreso de un medio fijo, como en la hoja: "pagos en efectivo" o "pagos desde cuentas".
// Si el medio tiene varias cuentas (Bancos, Nequi, Daviplata) se elige cuál.
export default function FormEgreso({ hoy, cuentas, bolsillos, categorias, proveedores, gastosFijos, creditos = [] }) {
  const { estado, enviando, onSubmit } = useEnvio(crearMovimiento, null, prepararFoto);
  const ref = useRef(null);
  useEffect(() => { if (estado?.ok) ref.current?.reset(); }, [estado]);

  return (
    <form ref={ref} onSubmit={onSubmit}>
      <input type="hidden" name="tipo" value="egreso" />
      {cuentas.length === 1 && <input type="hidden" name="cuenta_id" value={cuentas[0].id} />}
      <div className="formulario egreso">
        <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
        <label>Monto<input name="monto" inputMode="numeric" placeholder="0" required /></label>
        {cuentas.length > 1 && <label>Sale de<select name="cuenta_id" required defaultValue={cuentas[0]?.id}>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>}
        <label className="ancho">Motivo<input name="concepto" placeholder="Ej. Domicilio, abono Fernando, 4x1000" required /></label>
        <label>Bolsillo<select name="bolsillo_id" defaultValue="" required>
          <option value="" disabled>Elegir…</option>
          {bolsillos.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select></label>
        <label>Categoría<select name="categoria_id" defaultValue="" required>
          <option value="" disabled>Elegir…</option>
          {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <details className="ancho mas-datos"><summary>Proveedor, gasto fijo o crédito (opcional)</summary>
          <div className="formulario">
            <label>Proveedor<select name="tercero_id" defaultValue="">
              <option value="">—</option>
              {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
            <label>Gasto fijo<select name="gasto_fijo_id" defaultValue="">
              <option value="">—</option>
              {gastosFijos.map(g => <option key={g.id} value={g.id}>{g.concepto}</option>)}</select></label>
            {creditos.length > 0 && <label>Pago de crédito / banco<select name="credito_id" defaultValue="">
              <option value="">—</option>
              {creditos.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>}
          </div>
        </details>
        <label className="ancho">📎 Foto o PDF del comprobante (opcional)<input type="file" name="comprobante" accept="image/*,application/pdf" /></label>
        <div><button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : 'Registrar egreso'}</button></div>
      </div>
      {estado?.mensaje && <p className={`aviso ${estado.ok ? 'ok' : 'error'}`}>{estado.mensaje}</p>}
    </form>
  );
}
