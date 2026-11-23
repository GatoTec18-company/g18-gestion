// Base de datos local de G18 Gestión (PostgreSQL 17 dentro del proyecto).
//   npm run db:iniciar   → crea (la primera vez) e inicia el servidor
//   npm run db:detener   → lo apaga
//   npm run db:estado    → dice si está corriendo y qué migraciones tiene
//   npm run db:migrar    → aplica las migraciones nuevas de supabase/migrations
//   npm run db:reset     → BORRA la base y la crea de cero (pide confirmación)
//   npm run db:respaldo  → copia comprimida de toda la base en respaldos/
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BIN = path.join(RAIZ, 'node_modules/@embedded-postgres/darwin-arm64/native/bin');
const DATOS = path.join(RAIZ, '.datos/postgres');
const LOG = path.join(RAIZ, '.datos/postgres.log');
const ENV = path.join(RAIZ, '.env.local');
const MIGRACIONES = path.join(RAIZ, 'supabase/migrations');
const LOCAL = path.join(RAIZ, 'supabase/local');

// ---------- configuración (.env.local se crea solo con una clave aleatoria) ----------
function leerEnv() {
  if (!fs.existsSync(ENV)) {
    const clave = crypto.randomBytes(18).toString('base64url');
    fs.writeFileSync(ENV, [
      '# Base de datos local (no subir a git)',
      'DB_HOST=127.0.0.1',
      'DB_PORT=54329',
      'DB_USER=postgres',
      `DB_PASSWORD=${clave}`,
      'DB_NAME=g18_gestion',
      `DATABASE_URL=postgresql://postgres:${clave}@127.0.0.1:54329/g18_gestion`,
      `SESSION_SECRET=${crypto.randomBytes(32).toString('base64url')}`,
      '',
    ].join('\n'), { mode: 0o600 });
  }
  const env = {};
  for (const linea of fs.readFileSync(ENV, 'utf8').split('\n')) {
    const m = linea.match(/^([A-Z_]+)=(.*)$/);
    if (m) env[m[1]] = m[2];
  }
  return env;
}
const env = leerEnv();

const pgctl = (...args) => spawnSync(path.join(BIN, 'pg_ctl'), ['-D', DATOS, ...args], { encoding: 'utf8' });
const corriendo = () => fs.existsSync(path.join(DATOS, 'PG_VERSION')) && pgctl('status').status === 0;
const cliente = (db = env.DB_NAME) => new pg.Client({
  host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER, password: env.DB_PASSWORD, database: db,
});

// ---------- comandos ----------
// npm no ejecuta el paso de instalación del paquete de Postgres: se hace aquí (es inofensivo repetirlo)
function prepararBinarios() {
  const dir = path.resolve(BIN, '../..');
  const script = path.join(dir, 'scripts/hydrate-symlinks.js');
  if (!fs.existsSync(path.join(BIN, 'postgres'))) {
    console.error('No se encontró Postgres en node_modules. Ejecuta primero: npm install');
    process.exit(1);
  }
  if (fs.existsSync(script)) spawnSync(process.execPath, [script], { cwd: dir, stdio: 'ignore' });
}

// Al copiar la carpeta con algunas herramientas se pierden las carpetas vacías que Postgres necesita.
function repararCarpetasVacias() {
  if (!fs.existsSync(path.join(DATOS, 'PG_VERSION'))) return;
  for (const d of ['pg_notify', 'pg_tblspc', 'pg_replslot', 'pg_twophase', 'pg_snapshots', 'pg_commit_ts', 'pg_dynshmem',
    'pg_serial', 'pg_stat', 'pg_stat_tmp', 'pg_logical/snapshots', 'pg_logical/mappings']) {
    fs.mkdirSync(path.join(DATOS, d), { recursive: true, mode: 0o700 });
  }
  fs.chmodSync(DATOS, 0o700);
}

async function iniciar() {
  prepararBinarios();
  repararCarpetasVacias();
  if (!fs.existsSync(path.join(DATOS, 'PG_VERSION'))) {
    console.log('Creando el clúster de Postgres por primera vez…');
    fs.mkdirSync(DATOS, { recursive: true });
    const pwfile = path.join(RAIZ, '.datos/.pw');
    fs.writeFileSync(pwfile, env.DB_PASSWORD, { mode: 0o600 });
    try {
      execFileSync(path.join(BIN, 'initdb'), ['-D', DATOS, '-U', env.DB_USER, '--pwfile', pwfile,
        '--auth=scram-sha-256', '--encoding=UTF8', '--locale=C'], { stdio: 'inherit' });
    } finally { fs.rmSync(pwfile, { force: true }); }
    // Solo escucha en este computador, por TCP (la ruta del proyecto es muy larga para un socket Unix)
    fs.appendFileSync(path.join(DATOS, 'postgresql.conf'), [
      '', '# G18', `listen_addresses = '127.0.0.1'`, `port = ${env.DB_PORT}`,
      `unix_socket_directories = ''`, `timezone = 'America/Bogota'`, `log_timezone = 'America/Bogota'`, '',
    ].join('\n'));
  }
  if (corriendo()) { console.log('Postgres ya está corriendo.'); }
  else {
    const r = pgctl('-l', LOG, '-w', 'start');
    if (r.status !== 0) { console.error(r.stdout, r.stderr, `\nRevisa ${LOG}`); process.exit(1); }
    console.log(`Postgres iniciado en 127.0.0.1:${env.DB_PORT}`);
  }
  await crearBaseSiFalta();
  await migrar();
}

async function crearBaseSiFalta() {
  const c = cliente('postgres'); await c.connect();
  const { rowCount } = await c.query('select 1 from pg_database where datname = $1', [env.DB_NAME]);
  if (!rowCount) { await c.query(`create database ${env.DB_NAME}`); console.log(`Base ${env.DB_NAME} creada.`); }
  await c.end();
}

async function migrar() {
  const c = cliente(); await c.connect();
  try {
    await c.query(`create table if not exists public._migraciones (
      nombre text primary key, aplicada_en timestamptz not null default now())`);
    const hechas = new Set((await c.query('select nombre from public._migraciones')).rows.map(r => r.nombre));
    const pendientes = [
      ...fs.readdirSync(LOCAL).filter(f => /^\d\d_.*\.sql$/.test(f) && !f.startsWith('99_')).sort().map(f => ['local/' + f, path.join(LOCAL, f)]),
      ...fs.readdirSync(MIGRACIONES).filter(f => f.endsWith('.sql')).sort().map(f => [f, path.join(MIGRACIONES, f)]),
    ].filter(([nombre]) => !hechas.has(nombre));
    for (const [nombre, archivo] of pendientes) {
      await c.query('begin');
      try {
        await c.query(fs.readFileSync(archivo, 'utf8'));
        await c.query('insert into public._migraciones (nombre) values ($1)', [nombre]);
        await c.query('commit');
        console.log('  ✓ aplicada', nombre);
      } catch (e) {
        await c.query('rollback');
        throw new Error(`Falló ${nombre}: ${e.message}`);
      }
    }
    await c.query(fs.readFileSync(path.join(LOCAL, '99_permisos_local.sql'), 'utf8'));
    await c.query('revoke all on public._migraciones from anon, authenticated');
    console.log(pendientes.length ? 'Migraciones al día.' : 'No había migraciones nuevas.');
  } finally { await c.end(); }
}

async function estado() {
  if (!corriendo()) { console.log('Postgres está APAGADO. Usa: npm run db:iniciar'); return; }
  console.log(`Postgres corriendo en 127.0.0.1:${env.DB_PORT}, base ${env.DB_NAME}`);
  const c = cliente(); await c.connect();
  const r = await c.query(`select nombre, to_char(aplicada_en, 'YYYY-MM-DD HH24:MI') as fecha from public._migraciones order by aplicada_en, nombre`);
  console.table(r.rows);
  await c.end();
}

function detener() {
  if (!corriendo()) return console.log('Postgres ya estaba apagado.');
  const r = pgctl('-m', 'fast', '-w', 'stop');
  console.log(r.status === 0 ? 'Postgres detenido.' : r.stderr);
}

async function reset() {
  if (!process.argv.includes('--si')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const resp = await rl.question(`Esto BORRA toda la base ${env.DB_NAME}. Escribe BORRAR para continuar: `);
    rl.close();
    if (resp.trim() !== 'BORRAR') return console.log('Cancelado.');
  }
  if (!corriendo()) await iniciar();
  const c = cliente('postgres'); await c.connect();
  await c.query(`drop database if exists ${env.DB_NAME} with (force)`);
  await c.end();
  await crearBaseSiFalta();
  await migrar();
}

function respaldo() {
  const estaba = corriendo();
  if (estaba) detener();   // copia en frío: consistente al 100 %
  const dir = path.join(RAIZ, 'respaldos');
  fs.mkdirSync(dir, { recursive: true });
  const sello = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const archivo = path.join(dir, `g18_${sello}.tar.gz`);
  execFileSync('tar', ['-czf', archivo, '-C', path.dirname(DATOS), path.basename(DATOS)]);
  console.log('Respaldo creado:', path.relative(RAIZ, archivo));
  if (estaba) pgctl('-l', LOG, '-w', 'start');
}

const comandos = { iniciar, detener, estado, migrar, reset, respaldo };
const cmd = process.argv[2];
if (!comandos[cmd]) { console.log('Uso: node scripts/db.mjs ' + Object.keys(comandos).join('|')); process.exit(1); }
try { await comandos[cmd](); }
catch (e) { console.error('Error:', e.message); process.exit(1); }
