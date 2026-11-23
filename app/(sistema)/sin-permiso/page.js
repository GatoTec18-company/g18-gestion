import { contexto } from '@/lib/sesion';
import { Encabezado } from '@/components/ui/Comunes';

export default async function SinPermiso({ searchParams }) {
  await contexto(searchParams);
  return (
    <>
      <Encabezado titulo="Sin acceso" />
      <section className="caja">
        <p>Tu usuario no tiene permiso para ver esta sección. Si la necesitas, pídele al administrador que te la habilite en Configuración → Usuarios.</p>
      </section>
    </>
  );
}
