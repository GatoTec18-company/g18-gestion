/** @type {import('next').NextConfig} */
export default {
  serverExternalPackages: ['pg'],
  // La app de prueba (scripts/prueba.mjs) compila en otra carpeta para no chocar con la real
  distDir: process.env.NEXT_DIST_DIR || '.next',
};
