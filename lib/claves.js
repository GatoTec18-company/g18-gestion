import 'server-only';
import bcrypt from 'bcryptjs';

// Contraseñas con bcrypt (compatible con las que ya estaban guardadas).
export const cifrarClave = clave => bcrypt.hash(String(clave), 10);

export async function claveCorrecta(clave, hash) {
  if (!hash) return false;
  try { return await bcrypt.compare(String(clave), hash); } catch { return false; }
}
