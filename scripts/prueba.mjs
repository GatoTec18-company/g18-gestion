// Copia de la base para probar sin tocar los datos reales.
//   node scripts/prueba.mjs copiar   → crea g18_prueba como copia exacta de g18_gestion (la app real debe estar apagada)
//   node scripts/prueba.mjs app      → abre la app contra la copia en http://localhost:3019
//   node scripts/prueba.mjs borrar   → elimina la copia
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(fs.readFileSync(path.join(RAIZ, '.env.local'), 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const PRUEBA = /^g18_[a-z_]+$/.test(process.argv[3] ?? '') ? process.argv[3] : 'g18_prueba';
const urlPrueba = env.DATABASE_URL.replace(/\/[^/]+$/, `/${PRUEBA}`);

async function admin(sqlTexto) {
  const c = new pg.Client({ connectionString: env.DATABASE_URL.replace(/\/[^/]+$/, '/postgres') });
  await c.connect();
  try { await c.query(sqlTexto); } finally { await c.end(); }
}

const cmd = process.argv[2];
if (cmd === 'copiar') {
  await admin(`drop database if exists ${PRUEBA} with (force)`);
  await admin(`create database ${PRUEBA} template ${env.DB_NAME}`);
  console.log(`Copia ${PRUEBA} creada.`);
} else if (cmd === 'borrar') {
  await admin(`drop database if exists ${PRUEBA} with (force)`);
  console.log(`Copia ${PRUEBA} eliminada.`);
} else if (cmd === 'app') {
  spawn('npx', ['next', 'dev', '-p', '3019'], { cwd: RAIZ, stdio: 'inherit', env: { ...process.env, DATABASE_URL: urlPrueba, NEXT_DIST_DIR: '.next-prueba' } });
} else {
  console.log('Uso: node scripts/prueba.mjs copiar|app|borrar');
}
