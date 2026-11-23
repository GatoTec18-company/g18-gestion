// Subir la base a Supabase y respaldarla.
// Lee la conexión de la nube de .env.nube.local (NUBE_DATABASE_URL), que NO va al repositorio.
//
//   node scripts/nube.mjs probar     → prueba la conexión
//   node scripts/nube.mjs migrar     → crea/actualiza las tablas en Supabase (supabase/migrations)
//   node scripts/nube.mjs copiar     → copia TODOS los datos del Mac a Supabase (reemplaza lo que haya allá) y verifica
//   node scripts/nube.mjs respaldo   → descarga una copia de los datos de Supabase a respaldos/nube_<fecha>.json.gz
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

pg.types.setTypeParser(1082, v => v);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const leer = f => Object.fromEntries(fs.readFileSync(path.join(RAIZ, f), 'utf8').split('\n')
  .filter(l => /^[A-Z_]+=/.test(l)).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]));
if (!fs.existsSync(path.join(RAIZ, '.env.nube.local'))) {
  console.error('Falta el archivo .env.nube.local con NUBE_DATABASE_URL=… (la conexión "Session pooler" de Supabase).');
  process.exit(1);
}
const NUBE = leer('.env.nube.local').NUBE_DATABASE_URL;
const LOCAL = leer('.env.local').DATABASE_URL;
const nubeLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(NUBE); // solo para ensayos en el Mac
const nube = () => new pg.Client({ connectionString: NUBE, ssl: nubeLocal ? false : { rejectUnauthorized: false } });
const local = () => new pg.Client({ connectionString: LOCAL });
const host = new URL(NUBE).host;

// Tablas de la app (sin vistas), con sus columnas normales (sin columnas calculadas)
async function tablas(c) {
  const r = await c.query(`
    select t.table_name, array_agg(c.column_name::text order by c.ordinal_position) columnas
    from information_schema.tables t
    join information_schema.columns c on c.table_schema = t.table_schema and c.table_name = t.table_name
    where t.table_schema = 'public' and t.table_type = 'BASE TABLE' and c.is_generated = 'NEVER'
    group by t.table_name order by t.table_name`);
  return r.rows;
}

async function probar() {
  const c = nube(); await c.connect();
  const r = await c.query('select version(), current_user');
  console.log('Conectado a', host, '·', r.rows[0].version.slice(0, 16), '· usuario', r.rows[0].current_user);
  await c.end();
}

async function migrar() {
  const c = nube(); await c.connect();
  try {
    await c.query(`create table if not exists public._migraciones (nombre text primary key, aplicada_en timestamptz not null default now());
                   alter table public._migraciones enable row level security;`);
    // Postgres que no es Supabase (Neon u otro): crear antes lo mínimo que Supabase trae
    const tieneAuth = (await c.query(`select 1 from pg_namespace where nspname = 'auth'`)).rowCount > 0;
    if (!tieneAuth) {
      await c.query(fs.readFileSync(path.join(RAIZ, 'supabase/nube/00_compat_postgres.sql'), 'utf8'));
      console.log('  ✓ compatibilidad (no es Supabase): roles y esquema auth creados');
    }
    const hechas = new Set((await c.query('select nombre from public._migraciones')).rows.map(r => r.nombre));
    const dir = path.join(RAIZ, 'supabase/migrations');
    const pendientes = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort().filter(f => !hechas.has(f));
    for (const f of pendientes) {
      await c.query('begin');
      try {
        await c.query(fs.readFileSync(path.join(dir, f), 'utf8'));
        await c.query('insert into public._migraciones (nombre) values ($1)', [f]);
        await c.query('commit');
        console.log('  ✓', f);
      } catch (e) { await c.query('rollback'); throw new Error(`Falló ${f}: ${e.message}`); }
    }
    console.log(pendientes.length ? `Base en la nube al día (${pendientes.length} migraciones aplicadas).` : 'La base en la nube ya estaba al día.');
  } finally { await c.end(); }
}

async function copiar() {
  if (!process.argv.includes('--si')) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const r = await rl.question(`Esto REEMPLAZA todos los datos de ${host} por los de tu Mac. Escribe COPIAR para continuar: `);
    rl.close();
    if (r.trim() !== 'COPIAR') return console.log('Cancelado.');
  }
  const l = local(), n = nube();
  await l.connect(); await n.connect();
  try {
    const enLocal = await tablas(l);
    const enNube = new Set((await tablas(n)).map(t => t.table_name));
    const faltan = enLocal.filter(t => !enNube.has(t.table_name) && !t.table_name.startsWith('_'));
    if (faltan.length) throw new Error(`En Supabase faltan tablas (${faltan.map(t => t.table_name).join(', ')}). Ejecuta primero: node scripts/nube.mjs migrar`);
    // Orden de copia: primero las tablas a las que otras hacen referencia (llaves foráneas)
    const deps = (await l.query(`select c.conrelid::regclass::text hija, c.confrelid::regclass::text madre
      from pg_constraint c where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and c.confrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)`)).rows
      .map(d => ({ hija: d.hija.replace(/^public\./, ''), madre: d.madre.replace(/^public\./, '') }));
    const pendientesOrden = enLocal.filter(t => enNube.has(t.table_name) && t.table_name !== '_migraciones');
    const copiar = [];
    while (pendientesOrden.length) {
      const i = pendientesOrden.findIndex(t => !deps.some(d => d.hija === t.table_name && d.madre !== t.table_name
        && pendientesOrden.some(p => p.table_name === d.madre)));
      if (i < 0) throw new Error('Dependencias circulares entre tablas: ' + pendientesOrden.map(t => t.table_name).join(', '));
      copiar.push(...pendientesOrden.splice(i, 1));
    }
    const nombre = t => `public.${pg.escapeIdentifier(t.table_name)}`;

    await n.query('begin');
    // Sin triggers mientras se copia (no repartir bolsillos dos veces, no renumerar, no auditar, no bloquear meses cerrados).
    // No se usa session_replication_role porque Neon no lo permite.
    for (const t of copiar) await n.query(`alter table ${nombre(t)} disable trigger user`);
    await n.query(`truncate ${copiar.map(nombre).join(', ')} cascade`);
    for (const t of copiar) {
      const cols = t.columnas.map(pg.escapeIdentifier).join(', ');
      const filas = (await l.query(`select ${cols} from public.${pg.escapeIdentifier(t.table_name)}`)).rows;
      for (let i = 0; i < filas.length; i += 500) {
        await n.query(`insert into public.${pg.escapeIdentifier(t.table_name)} (${cols})
                       select ${cols} from json_populate_recordset(null::public.${pg.escapeIdentifier(t.table_name)}, $1)`,
          [JSON.stringify(filas.slice(i, i + 500))]);
      }
      console.log(`  ${t.table_name}: ${filas.length}`);
    }
    // Contadores (ids numéricos) al día
    const seqs = (await n.query(`select s.relname seq, t.relname tabla, a.attname col from pg_class s
      join pg_depend d on d.objid = s.oid join pg_class t on t.oid = d.refobjid
      join pg_attribute a on a.attrelid = t.oid and a.attnum = d.refobjsubid
      where s.relkind = 'S' and s.relnamespace = 'public'::regnamespace`)).rows;
    for (const s of seqs) {
      await n.query(`select setval('public.${s.seq}', coalesce((select max(${pg.escapeIdentifier(s.col)}) from public.${pg.escapeIdentifier(s.tabla)}), 0) + 1, false)`);
    }
    for (const t of copiar) await n.query(`alter table ${nombre(t)} enable trigger user`);
    await n.query('commit');

    // Verificación: mismas filas y mismos totales
    let ok = true;
    for (const t of copiar) {
      const q = `select count(*)::int n from public.${pg.escapeIdentifier(t.table_name)}`;
      const [a, b] = [(await l.query(q)).rows[0].n, (await n.query(q)).rows[0].n];
      if (a !== b) { ok = false; console.log(`  ✗ ${t.table_name}: Mac ${a} · nube ${b}`); }
    }
    const tot = `select coalesce(sum(case tipo when 'ingreso' then monto else -monto end), 0)::text s from movimientos`;
    const [sa, sb] = [(await l.query(tot)).rows[0].s, (await n.query(tot)).rows[0].s];
    if (sa !== sb) { ok = false; console.log(`  ✗ saldo total: Mac ${sa} · nube ${sb}`); }
    const bol = `select coalesce(sum(monto), 0)::text s from movimiento_bolsillos`;
    const [ba, bb] = [(await l.query(bol)).rows[0].s, (await n.query(bol)).rows[0].s];
    if (ba !== bb) { ok = false; console.log(`  ✗ bolsillos: Mac ${ba} · nube ${bb}`); }
    console.log(ok ? `✓ Copia verificada: ${copiar.length} tablas, saldo total ${Number(sa).toLocaleString('es-CO')}.` : '✗ La copia no cuadra; revisa los mensajes.');
    if (!ok) process.exitCode = 1;
  } catch (e) {
    await n.query('rollback').catch(() => {});
    throw e;
  } finally { await l.end(); await n.end(); }
}

async function respaldo() {
  const c = nube(); await c.connect();
  try {
    const datos = { origen: host, fecha: new Date().toISOString(), tablas: {} };
    for (const t of await tablas(c)) {
      datos.tablas[t.table_name] = (await c.query(`select * from public.${pg.escapeIdentifier(t.table_name)}`)).rows;
    }
    fs.mkdirSync(path.join(RAIZ, 'respaldos'), { recursive: true });
    const archivo = path.join(RAIZ, 'respaldos', `nube_${new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19)}.json.gz`);
    fs.writeFileSync(archivo, zlib.gzipSync(JSON.stringify(datos)));
    console.log('Respaldo de la nube guardado en', path.relative(RAIZ, archivo));
  } finally { await c.end(); }
}

const cmds = { probar, migrar, copiar, respaldo };
const cmd = process.argv[2];
if (!cmds[cmd]) { console.log('Uso: node scripts/nube.mjs ' + Object.keys(cmds).join('|')); process.exit(1); }
try { await cmds[cmd](); } catch (e) { console.error('Error:', e.message); process.exit(1); }
