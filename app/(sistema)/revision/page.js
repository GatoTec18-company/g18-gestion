import { redirect } from 'next/navigation';

// La revisión ahora es la etapa 1 del seguimiento de ventas
export default function Revision() {
  redirect('/cartera?etapa=por_confirmar');
}
