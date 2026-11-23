import Link from 'next/link';
import { notFound } from 'next/navigation';
import { sql, uno } from '@/lib/db';
import { requerir } from '@/lib/sesion';
import { cop, fecha } from '@/lib/formato';
import { enlaceWhatsApp } from '@/lib/whatsapp';
import Acciones from '@/components/ui/Acciones';

const uuid = v => /^[0-9a-f-]{36}$/i.test(v ?? '');

// Recibo de un abono del cliente: para imprimir, guardar en PDF o mandar por WhatsApp.
export default async function Recibo({ params, searchParams }) {
  const ctx = await requerir(searchParams, 'pedidos');
  const { id, abono } = await params;
  if (!uuid(id) || !uuid(abono)) notFound();
  const p = await uno(`select v.*, p.abonado_previo, e.nombre empresa, e.nit from v_pedidos v join pedidos p on p.id = v.id join empresas e on e.id = v.empresa_id
                       where v.id = $1 and v.empresa_id = any($2)`, [id, ctx.empresasCon('pedidos')]);
  if (!p) notFound();
  const abonos = await sql(`select a.id, a.fecha, a.monto, c.nombre cuenta, c.tipo from pedido_abonos a left join cuentas c on c.id = a.cuenta_id
                            where a.pedido_id = $1 order by a.fecha, a.creado_en`, [id]);
  const i = abonos.findIndex(a => a.id === abono);
  if (i < 0) notFound();
  const a = abonos[i];
  const numero = `${p.numero}-${i + 1}`;
  const acumulado = (p.abonado_previo ?? 0) + abonos.slice(0, i + 1).reduce((s, x) => s + x.monto, 0);
  const saldo = p.valor === null ? null : p.valor - acumulado;
  const medio = a.tipo === 'efectivo' ? 'Efectivo' : a.cuenta ?? '—';
  const texto = [`*${p.empresa}* — Recibo de abono N° ${numero}`, `Fecha: ${fecha(a.fecha)}`, `Cliente: ${p.cliente ?? '—'}`,
    `Pedido ${p.numero}: ${p.producto ?? ''}`, `Abono recibido: ${cop(a.monto)} (${medio})`,
    p.valor !== null && `Valor del pedido: ${cop(p.valor)}`, `Total abonado: ${cop(acumulado)}`,
    saldo !== null && (saldo > 0 ? `Saldo pendiente: ${cop(saldo)}` : 'Pedido pagado en su totalidad ✅'), '¡Gracias por su compra!'].filter(Boolean).join('\n');

  return (
    <>
      <div className="no-imprimir" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
        <Link href={`/pedidos/${id}`} className="btn-sec btn-link">← Volver al pedido</Link>
        <a className="btn btn-link btn-wa" href={enlaceWhatsApp(p.telefono, texto)} target="_blank" rel="noopener noreferrer">Enviar por WhatsApp</a>
        <Acciones />
      </div>
      <article className="recibo">
        <header><div><b className="recibo-emp">{p.empresa}</b>{p.nit && <div className="muted">NIT {p.nit}</div>}</div>
          <div className="recibo-num"><span className="muted">Recibo de abono</span><b>N° {numero}</b><span>{fecha(a.fecha)}</span></div></header>
        <dl>
          <dt>Cliente</dt><dd>{p.cliente ?? '—'}{p.telefono ? ` · ${p.telefono}` : ''}</dd>
          <dt>Pedido</dt><dd>{p.numero} · {p.producto ?? ''}</dd>
          <dt>Medio de pago</dt><dd>{medio}</dd>
        </dl>
        <div className="recibo-monto"><span>Abono recibido</span><b>{cop(a.monto)}</b></div>
        <dl>
          {p.valor !== null && <><dt>Valor del pedido</dt><dd className="n">{cop(p.valor)}</dd></>}
          <dt>Total abonado</dt><dd className="n">{cop(acumulado)}</dd>
          {saldo !== null && <><dt>Saldo pendiente</dt><dd className={`n ${saldo > 0 ? 'neg' : 'pos'}`}><b>{saldo > 0 ? cop(saldo) : 'Pagado ✓'}</b></dd></>}
        </dl>
        <p className="muted recibo-pie">Gracias por su compra.</p>
      </article>
    </>
  );
}
