'use client';
import { useEffect, useRef, useState } from 'react';
import { crearVenta } from '@/servidor/ventas';
import CamposCliente from './CamposCliente';
import useEnvio from './useEnvio';

// Registro de ventas cuyo pago llega después: Addi, Sumas Pay, cooperativas, tarjeta de crédito.
// (El efectivo y las transferencias del día se registran como total en el Libro diario.)
export default function FormVenta({ hoy, entidades, vendedores, clientes, eligeVendedor, revisaSolo }) {
  const { estado, enviando, onSubmit } = useEnvio(crearVenta);
  const [vend, setVend] = useState('');
  const ref = useRef(null);
  useEffect(() => { if (estado?.ok) { ref.current?.reset(); setVend(''); } }, [estado]);

  return (
    <form ref={ref} onSubmit={onSubmit}>
      <div className="formulario">
        <label>Entidad<select name="entidad_id" required defaultValue="">
          <option value="" disabled>Elegir…</option>
          {entidades.map(x => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select></label>
        <label>Valor de la venta<input name="total" inputMode="numeric" placeholder="0" required /></label>
        <label>Fecha de la venta<input type="date" name="fecha" defaultValue={hoy} required /></label>
        <label>N° de factura<input name="numero_factura" placeholder="FEG…" /></label>
        <label className="ancho">Producto o equipo<input name="producto" required placeholder="Ej. Portátil Lenovo IdeaPad 3, serial PF4X…" /></label>
        <label>N° de aprobación / ID del crédito<input name="referencia" placeholder="Del voucher o del crédito" /></label>
        <label>Canal<input name="detalle" placeholder="Tienda física, marketplace…" /></label>
        {eligeVendedor && <label>Vendedor<select name="vendedor_id" value={vend} onChange={e => setVend(e.target.value)}>
          <option value="">—</option>
          {vendedores.map(v => <option key={v.id} value={v.id}>{v.nombre}</option>)}
          <option value="nuevo">+ Vendedor nuevo…</option></select></label>}
        {vend === 'nuevo' && <label>Nombre del vendedor<input name="vendedor_nuevo" required /></label>}
        <CamposCliente clientes={clientes} obligatorio />
        <div><button className="btn" disabled={enviando}>{enviando ? 'Guardando…' : 'Registrar venta'}</button></div>
      </div>
      <p className="muted">La fecha estimada de pago se calcula sola según la entidad.{!revisaSolo && ' La venta queda pendiente de revisión del administrador.'}</p>
      {estado?.mensaje && <p className={`aviso ${estado.ok ? 'ok' : 'error'}`}>{estado.mensaje}</p>}
    </form>
  );
}
