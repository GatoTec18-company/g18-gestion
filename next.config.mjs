/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ['pg'],
  // fotos de comprobantes (ya comprimidas en el navegador, máx. 3 MB)
  experimental: { serverActions: { bodySizeLimit: '4mb' } },
  // La app de prueba (scripts/prueba.mjs) compila en otra carpeta para no chocar con la real
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
