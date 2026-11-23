import Link from 'next/link';
import { mesVecino, nombreMes } from '@/lib/formato';

export function Encabezado({ titulo, sub, children }) {
  return (
    <header className="enc">
      <div><h1>{titulo}</h1>{sub && <p className="sub">{sub}</p>}</div>
      <div className="enc-der">{children}</div>
    </header>
  );
}

export function SelectorMes({ mes, ruta }) {
  return (
    <div className="mes-nav">
      <Link href={`${ruta}?mes=${mesVecino(mes, -1)}`} aria-label="Mes anterior">‹</Link>
      <span>{nombreMes(mes)}</span>
      <Link href={`${ruta}?mes=${mesVecino(mes, 1)}`} aria-label="Mes siguiente">›</Link>
    </div>
  );
}

const TONOS = {
  'OK': 'verde', 'EN PLAZO': 'verde', 'Pagado': 'verde', 'Aplicado en factura': 'verde',
  'ATRASADO': 'rojo', 'Vencido': 'rojo', 'FALTA VALOR': 'ambar', 'POR PEDIR': 'ambar', 'Parcial': 'ambar',
  'Por vencer': 'ambar', 'ENTREGA PRÓXIMA': 'ambar', 'Pagado: falta aplicar en factura': 'azul',
  'Por confirmar': 'ambar', 'Pendiente': 'gris', 'CANCELADO': 'gris',
  'Por revisar': 'ambar', 'Sin fecha de pago': 'gris', 'Pagada': 'verde', 'Vencida': 'rojo', 'Aprobada': 'verde', 'Rechazada': 'rojo',
  'Entregado': 'verde', 'Cerrada': 'verde', 'Esperando pago': 'azul', 'Por aplicar en factura': 'azul', 'Cancelado': 'gris',
};
export function Chip({ children }) {
  return <span className={`chip ${TONOS[children] ?? 'gris'}`}>{children}</span>;
}

export function Vacio({ children }) {
  return <p className="vacio">{children}</p>;
}
