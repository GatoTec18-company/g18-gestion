import Link from 'next/link';
import { sql } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { hoy as hoyCol } from '@/lib/fechas';
import { Encabezado } from '@/components/ui/Comunes';
import FormAccion from '@/components/formularios/FormAccion';
import CamposCliente from '@/components/formularios/CamposCliente';
import { crearPedido } from '@/servidor/pedidos';

export default async function NuevoPedido({ searchParams }) {
  const { empresa } = await requerir(searchParams, 'pedidos');
  const e = empresa.id;
  const [clientes, proveedores, cuentas] = await Promise.all([
    sql(`select id, nombre, documento, telefono from terceros where empresa_id = $1 and es_cliente order by nombre`, [e]),
    sql(`select id, nombre from terceros where empresa_id = $1 and es_proveedor order by nombre`, [e]),
    sql(`select id, nombre, tipo from cuentas where empresa_id = $1 and activa order by tipo, nombre`, [e]),
  ]);
  const hoy = hoyCol();
  return (
    <>
      <Encabezado titulo="Nuevo pedido bajo encargo" sub={`${empresa.nombre} · el número (PED-…) se asigna solo`}>
        <Link href="/pedidos" className="btn-sec btn-link">Volver</Link>
      </Encabezado>
      <section className="caja">
        <FormAccion action={crearPedido} boton="Crear pedido">
          <input type="hidden" name="empresa_id" value={e} />
          <label>Fecha del pedido<input type="date" name="fecha_pedido" defaultValue={hoy} required /></label>
          <label>Entrega estimada<input type="date" name="fecha_estimada" /></label>
          <label className="ancho">Producto<input name="producto" required placeholder="Ej. Tarjeta de encendido HP 245 G7" /></label>
          <label>Valor para el cliente<input name="valor" inputMode="numeric" placeholder="Vacío si aún no se sabe" /></label>
          <CamposCliente clientes={clientes} />
          <label>Proveedor (opcional)<select name="proveedor_id" defaultValue="">
            <option value="">—</option>{proveedores.map(p => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></label>
          <label>Abono inicial<input name="abono" inputMode="numeric" placeholder="0" /></label>
          <label>Medio del abono<select name="cuenta_id" defaultValue={cuentas.find(c => c.tipo === 'efectivo')?.id}>
            {cuentas.map(c => <option key={c.id} value={c.id}>{c.nombre}</option>)}</select></label>
          <label className="ancho">Observaciones<input name="observaciones" placeholder="Ej. Avisar a la cliente cuando llegue" /></label>
        </FormAccion>
        <p className="muted">El abono queda registrado en el pedido para controlar el saldo del cliente. La plata entra a la caja con el total del día en el Libro diario.</p>
      </section>
    </>
  );
}
