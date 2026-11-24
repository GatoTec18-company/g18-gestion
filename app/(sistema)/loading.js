// Se muestra al instante al tocar un módulo, mientras llegan los datos
export default function Cargando() {
  return (
    <div className="cargando" aria-busy="true" aria-live="polite">
      <div className="esq esq-titulo" />
      <div className="esq-kpis"><div className="esq" /><div className="esq" /><div className="esq" /></div>
      <div className="esq esq-caja" />
      <span className="sr-only">Cargando…</span>
    </div>
  );
}
