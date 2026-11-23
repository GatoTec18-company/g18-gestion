'use client';
import { useEffect, useState } from 'react';
import { guardarVentasDia } from '@/servidor/libro';
import useEnvio from './useEnvio';

const fmt = n => (n ? Number(n).toLocaleString('es-CO') : '');
const num = s => Number(String(s ?? '').replace(/[^\d]/g, '')) || 0;

// porDia: { 'AAAA-MM-DD': { [cuentaId]: monto } } con lo ya registrado, para mostrarlo y reemplazarlo
export default function FormVentasDia({ hoy, cuentaEfectivo, cuentasBanco, porDia }) {
  const { estado, enviando, onSubmit } = useEnvio(guardarVentasDia);
  const [fecha, setFecha] = useState(hoy);
  const [banco, setBanco] = useState(cuentasBanco[0]?.id ?? '');
  const [ef, setEf] = useState('');
  const [bc, setBc] = useState('');
  // Al cambiar de día (o de cuenta) se cargan los valores ya registrados
  useEffect(() => {
    const d = porDia[fecha] ?? {};
    setEf(fmt(d[cuentaEfectivo?.id]));
    setBc(fmt(d[banco]));
  }, [fecha, banco, porDia]); // eslint-disable-line
  const total = num(ef) + num(bc);
  const yaHabia = Object.keys(porDia[fecha] ?? {}).length > 0;

  return (
    <form onSubmit={onSubmit}>
      <input type="hidden" name="cuenta_efectivo" value={cuentaEfectivo?.id ?? ''} />
      <div className="formulario ventas-dia">
        <label>Día<input type="date" name="fecha" value={fecha} onChange={e => setFecha(e.target.value)} required /></label>
        <label>💵 Efectivo<input name="efectivo" value={ef} onChange={e => setEf(e.target.value)} inputMode="numeric" placeholder="0" /></label>
        <label>🏦 Cuentas{cuentasBanco.length > 1 && (
          <select name="cuenta_banco" value={banco} onChange={e => setBanco(e.target.value)} style={{ marginBottom: 4 }}>
            {cuentasBanco.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select>)}
          {cuentasBanco.length === 1 && <input type="hidden" name="cuenta_banco" value={banco} />}
          <input name="banco" value={bc} onChange={e => setBc(e.target.value)} inputMode="numeric" placeholder="0" /></label>
        <div className="total-dia"><span className="muted">Total del día</span><b>${total.toLocaleString('es-CO')}</b></div>
        <div><button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : yaHabia ? 'Actualizar día' : 'Guardar día'}</button></div>
      </div>
      <p className="muted">{yaHabia ? 'Este día ya tenía ventas: al guardar se reemplazan por estos valores (0 = borrar).' : 'Se reparte solo en los bolsillos 75 / 10 / 10 / 5.'}</p>
      {estado?.mensaje && <p className={`aviso ${estado.ok ? 'ok' : 'error'}`}>{estado.mensaje}</p>}
    </form>
  );
}
