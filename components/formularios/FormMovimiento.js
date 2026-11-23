'use client';
import { useEffect, useRef, useState } from 'react';
import { crearMovimiento } from '@/servidor/libro';
import useEnvio from './useEnvio';

export default function FormMovimiento({ hoy, cuentas, bolsillos, categorias, proveedores, gastosFijos }) {
  const { estado, enviando, onSubmit } = useEnvio(crearMovimiento);
  const [tipo, setTipo] = useState('egreso');
  const ref = useRef(null);
  useEffect(() => { if (estado?.ok) ref.current?.reset(); }, [estado]);

  return (
    <form ref={ref} onSubmit={onSubmit}>
      <div className="formulario">
        <div className="tipo-sel">
          <label><input type="radio" name="tipo" value="egreso" checked={tipo === 'egreso'} onChange={() => setTipo('egreso')} /> Egreso</label>
          <label><input type="radio" name="tipo" value="ingreso" checked={tipo === 'ingreso'} onChange={() => setTipo('ingreso')} /> Ingreso</label>
        </div>
        <label>Fecha<input type="date" name="fecha" defaultValue={hoy} required /></label>
        <label>Cuenta<select name="cuenta_id" required defaultValue="">
          <option value="" disabled>Elegir…</option>
          {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
        <label>Monto<input name="monto" inputMode="numeric" placeholder="0" required /></label>
        <label className="ancho">Concepto<input name="concepto" placeholder={tipo === 'egreso' ? 'Ej. Abono Fernando' : 'Ej. Ventas del día'} required /></label>
        <label>Bolsillo<select name="bolsillo_id" defaultValue="" required={tipo === 'egreso'}>
          <option value="">{tipo === 'ingreso' ? 'Repartir 75/10/10/5' : 'Elegir…'}</option>
          {bolsillos.map(b => <option key={b.id} value={b.id}>{b.codigo} · {b.nombre}</option>)}</select></label>
        {tipo === 'egreso' && <>
          <label>Categoría<select name="categoria_id" defaultValue="" required>
            <option value="" disabled>Elegir…</option>
            {categorias.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <label>Proveedor (opcional)<select name="tercero_id" defaultValue="">
            <option value="">—</option>
            {proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label>Gasto fijo (opcional)<select name="gasto_fijo_id" defaultValue="">
            <option value="">—</option>
            {gastosFijos.map(g => <option key={g.id} value={g.id}>{g.concepto}</option>)}</select></label>
        </>}
        <div><button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : 'Guardar'}</button></div>
      </div>
      {estado?.mensaje && <p className={`aviso ${estado.ok ? 'ok' : 'error'}`}>{estado.mensaje}</p>}
    </form>
  );
}
