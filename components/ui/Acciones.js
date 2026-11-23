'use client';

// Botones para llevarse la información: Excel (archivo CSV) e imprimir / guardar como PDF.
export default function Acciones({ excel, pdf = true }) {
  return (
    <div className="acciones no-imprimir">
      {excel && <a className="btn-sec btn-link" href={excel} download>⬇ Excel</a>}
      {pdf && <button type="button" className="btn-sec" onClick={() => window.print()}>🖨 Imprimir / PDF</button>}
    </div>
  );
}
