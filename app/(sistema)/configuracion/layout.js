import { requerir } from '@/lib/sesion';
import { Encabezado } from '@/components/ui/Comunes';
import SubnavConfig from '@/components/marco/SubnavConfig';

export default async function LayoutConfig({ children }) {
  const { empresa } = await requerir(undefined, 'configuracion');
  return (
    <>
      <Encabezado titulo="Configuración" sub={empresa.nombre} />
      <SubnavConfig />
      {children}
    </>
  );
}
