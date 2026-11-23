import pg from 'pg'; import fs from 'node:fs';
const env = Object.fromEntries(fs.readFileSync(process.argv[2],'utf8').split('\n').filter(l=>/^[A-Z_]+=/.test(l)).map(l=>[l.split('=')[0], l.slice(l.indexOf('=')+1)]));
const c = new pg.Client({connectionString: env.DATABASE_URL}); await c.connect();
const q = async (s) => (await c.query(s)).rows;
console.log('version:', (await q('select version()'))[0].version.slice(0,30));
console.table(await q(`select e.nombre, (select count(*) from cuentas where empresa_id=e.id) cuentas, (select count(*) from bolsillos where empresa_id=e.id) bolsillos, (select count(*) from categorias_gasto where empresa_id=e.id) categorias, (select count(*) from terceros where empresa_id=e.id) proveedores, (select count(*) from gastos_fijos where empresa_id=e.id) gastos_fijos from empresas e`));
// usuario de prueba con RLS real (en transacción que se deshace)
await c.query('begin');
const u = (await q(`insert into usuarios (email, clave_hash) values ('prueba@local', 'x') returning id`))[0].id;
await c.query(`insert into miembros (user_id, empresa_id, nombre, rol) values ('${u}', '00000000-0000-0000-0000-000000000018', 'Prueba', 'colaborador')`);
await c.query(`set local role authenticated; select set_config('request.jwt.claim.sub', '${u}', true)`);
console.log('RLS colaborador G18 →', (await q(`select (select count(*) from empresas) empresas, (select count(*) from cuentas) cuentas, auth.uid() is not null as sesion`))[0]);
await c.query('rollback'); await c.end();
