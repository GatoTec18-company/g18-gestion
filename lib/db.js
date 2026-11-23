import pg from 'pg';

// Fechas (DATE) como texto 'AAAA-MM-DD' para evitar corrimientos de zona horaria
pg.types.setTypeParser(1082, v => v);
// numeric y bigint → número de JS
pg.types.setTypeParser(1700, v => (v === null ? null : Number(v)));
pg.types.setTypeParser(20, v => Number(v));

// Local: Postgres del proyecto. En la nube (Vercel): DATABASE_URL apunta al pooler de Supabase con SSL.
const url = process.env.DATABASE_URL;
const esLocal = /@(127\.0\.0\.1|localhost)[:/]/.test(url ?? '');
const pool = globalThis.__g18pool ?? new pg.Pool({
  connectionString: url,
  max: esLocal ? 5 : 3,                       // en la nube cada instancia abre pocas conexiones
  idleTimeoutMillis: 10_000,
  ssl: esLocal ? false : { rejectUnauthorized: false },
});
if (process.env.NODE_ENV !== 'production') globalThis.__g18pool = pool;

export async function sql(texto, params = []) {
  return (await pool.query(texto, params)).rows;
}
export async function uno(texto, params = []) {
  return (await sql(texto, params))[0] ?? null;
}

// Ejecuta varias consultas como una sola operación: o se guarda todo o nada.
// Con usuarioId, la base sabe quién hace el cambio (auth.uid(): "registrado por" y auditoría).
export async function transaccion(fn, usuarioId = null) {
  const cliente = await pool.connect();
  const q = async (texto, params = []) => (await cliente.query(texto, params)).rows;
  try {
    await cliente.query('begin');
    if (usuarioId) await cliente.query(`select set_config('request.jwt.claim.sub', $1, true)`, [usuarioId]);
    const r = await fn(q);
    await cliente.query('commit');
    return r;
  } catch (e) {
    await cliente.query('rollback');
    throw e;
  } finally {
    cliente.release();
  }
}
