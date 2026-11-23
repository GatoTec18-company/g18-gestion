// Fechas en hora de Colombia (toISOString usa UTC y después de las 7 p. m. daba el día siguiente).
const ZONA = 'America/Bogota';

export function hoy() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: ZONA, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

export const mesActual = () => hoy().slice(0, 7);
