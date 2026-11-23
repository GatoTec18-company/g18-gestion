// En el navegador: reduce las fotos antes de subirlas (máx. 1600 px, JPG) para que suban rápido y ocupen poco.
const MAX_LADO = 1600;
const MAX_BYTES = 3 * 1024 * 1024;

export async function comprimir(archivo) {
  if (!archivo || !archivo.size) return null;
  if (archivo.type === 'application/pdf') {
    if (archivo.size > MAX_BYTES) throw new Error('El PDF pesa más de 3 MB.');
    return archivo;
  }
  if (!archivo.type.startsWith('image/')) throw new Error('Solo se aceptan fotos o PDF.');
  let img;
  try { img = await createImageBitmap(archivo, { imageOrientation: 'from-image' }); }
  catch { throw new Error('No se pudo leer la foto. Prueba con otra (JPG o PNG).'); }
  const escala = Math.min(1, MAX_LADO / Math.max(img.width, img.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(img.width * escala); lienzo.height = Math.round(img.height * escala);
  const c = lienzo.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, lienzo.width, lienzo.height);
  c.drawImage(img, 0, 0, lienzo.width, lienzo.height);
  for (const calidad of [0.8, 0.65, 0.5]) {
    const blob = await new Promise(r => lienzo.toBlob(r, 'image/jpeg', calidad));
    if (blob && blob.size <= MAX_BYTES) return new File([blob], (archivo.name || 'foto').replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  }
  throw new Error('La foto es demasiado grande.');
}

// Reemplaza en el FormData el archivo del campo por su versión comprimida
export async function comprimirCampo(fd, campo) {
  const f = fd.get(campo);
  if (!f || typeof f === 'string' || !f.size) { fd.delete(campo); return fd; }
  fd.set(campo, await comprimir(f));
  return fd;
}
