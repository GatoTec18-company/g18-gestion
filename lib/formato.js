const fmt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
export const cop = v => (v === null || v === undefined ? '—' : `${v < 0 ? '−' : ''}$${fmt.format(Math.abs(Math.round(v)))}`);
export const num = v => (v === null || v === undefined ? '—' : fmt.format(v));
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
export const nombreMes = m => { const [a, n] = m.split('-').map(Number); return `${MESES[n - 1]} ${a}`; };
export const fecha = d => { if (!d) return '—'; const [a, m, dd] = String(d).slice(0, 10).split('-'); return `${dd}/${m}/${a}`; };
export const mesVecino = (m, delta) => {
  const [a, n] = m.split('-').map(Number); const d = new Date(a, n - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
