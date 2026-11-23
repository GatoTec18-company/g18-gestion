import { contexto } from '@/lib/sesion';
import { alertas } from '@/lib/alertas';
import { Encabezado } from '@/components/ui/Comunes';
import ListaAlertas from '@/components/ui/ListaAlertas';

export default async function Alertas({ searchParams }) {
  const ctx = await contexto(searchParams);
  const lista = await alertas(ctx);
  const rojas = lista.filter(a => a.nivel === 'rojo').length;
  return (
    <>
      <Encabezado titulo="Alertas" sub={`${ctx.empresa.nombre} · ${rojas ? `${rojas} vencida${rojas === 1 ? '' : 's'}` : 'nada vencido'} · avisa con 5 días de anticipación`} />
      <section className="caja">
        <ListaAlertas lista={lista} />
        <p className="muted">Rojo: ya se venció o está atrasado. Amarillo: se vence pronto o está pendiente. Toca una alerta para ir a resolverla.</p>
      </section>
    </>
  );
}
