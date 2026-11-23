import { cop, fecha } from '@/lib/formato';
import { enlaceWhatsApp, telefonoWhatsApp } from '@/lib/whatsapp';

// Botones que abren WhatsApp con el mensaje listo para el cliente del pedido
export default function AvisarCliente({ p, empresa }) {
  const saludo = `Hola${p.cliente ? ` ${p.cliente.split(' ')[0]}` : ''}, le escribimos de ${empresa}.`;
  const mensajes = [
    ['📦 Ya llegó', `${saludo} Su pedido ${p.numero} (${p.producto ?? ''}) ya llegó y está listo para recoger.${p.saldo > 0 ? ` El saldo pendiente es ${cop(p.saldo)}.` : ''} ¡Lo esperamos!`],
    p.saldo > 0 && ['💰 Recordar saldo', `${saludo} Le recordamos que su pedido ${p.numero} (${p.producto ?? ''}) tiene un saldo pendiente de ${cop(p.saldo)}. Abonado hasta hoy: ${cop(p.abonado)}.`],
    p.fecha_estimada && !['entregado', 'cancelado', 'recibido_en_tienda'].includes(p.estado) && ['🚚 Fecha de entrega', `${saludo} Su pedido ${p.numero} (${p.producto ?? ''}) está en proceso. La fecha estimada de entrega es el ${fecha(p.fecha_estimada)}. Le avisamos apenas llegue.`],
  ].filter(Boolean);
  const valido = telefonoWhatsApp(p.telefono);
  return (
    <div>
      <div className="botones-wa">
        {mensajes.map(([t, m]) => <a key={t} className="btn-sec btn-link" href={enlaceWhatsApp(p.telefono, m)} target="_blank" rel="noopener noreferrer">{t}</a>)}
      </div>
      <p className="muted">{valido ? `Se abre WhatsApp con el mensaje listo para ${p.telefono}. Revísalo y toca enviar.`
        : 'El cliente no tiene un celular válido: WhatsApp se abrirá para que elijas a quién enviarlo.'} El recibo de cada abono está en el historial.</p>
    </div>
  );
}
