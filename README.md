# G18 Gestión

Sistema unificado de G18 Corporation SAS y Gatotec 18 (reemplaza la app de escritorio y los Google Sheets).

## Para usarlo (día a día)

Abre la Terminal en esta carpeta y ejecuta:

```bash
npm run iniciar
```

Inicia la base de datos y la app. Luego abre http://localhost:3018 en el navegador. Para apagar: `Ctrl + C` en la Terminal y después `npm run db:detener`.

La primera vez en un computador nuevo, antes ejecuta `npm install`.

## Base de datos local

PostgreSQL 17 corre dentro del proyecto (no hay que instalar nada aparte). Requiere Node.js.

```bash
npm install          # la primera vez
npm run db:iniciar   # crea la base (la primera vez), la inicia y aplica migraciones
```

| Comando | Qué hace |
|---|---|
| `npm run db:iniciar` | Inicia Postgres en `127.0.0.1:54329` y aplica migraciones nuevas. Hay que correrlo después de reiniciar el Mac. |
| `npm run db:detener` | Apaga Postgres. |
| `npm run db:estado` | Dice si está corriendo y qué migraciones tiene. |
| `npm run db:migrar` | Aplica migraciones nuevas de `supabase/migrations`. |
| `npm run db:respaldo` | Copia comprimida de toda la base en `respaldos/`. |
| `npm run db:verificar` | Revisa datos base y la seguridad por empresa. |
| `npm run db:importar` | Importa el histórico de noviembre (libro diario, pedidos, ventas financiadas). Solo guarda si todo cuadra con las hojas y no repite lo ya importado. |
| `npm run db:reset` | **Borra** la base y la crea de cero (pide escribir BORRAR). |

- La conexión y la clave están en `.env.local` (`DATABASE_URL`), que se crea solo. No se sube a git.
- Los datos viven en `.datos/postgres`.

## La app

```bash
npm run dev          # abre la app en http://localhost:3018 (la base debe estar iniciada)
```

- La primera vez, la pantalla de entrada pide **crear el administrador** (acceso total a las dos empresas).
- El administrador crea los demás usuarios en **Configuración → Usuarios y permisos**: rol (Vendedor, Cajero, Colaborador o Administrador) y casillas de permisos por módulo. Al primer ingreso cada persona cambia su contraseña temporal.
- Las ventas **financiadas** (Addi, Sumas Pay, Cooperativa, Tarjeta de crédito, crédito de la tienda) que registra el personal quedan **por revisar** y el administrador las aprueba o rechaza en **Revisión de ventas**.
- **Caja por total del día:** lo que registra el personal (ventas, abonos de pedidos, pagos de entidades) es de control y no mueve la caja; el administrador registra el total del día en el Libro diario. Se puede cambiar en Configuración → Empresa.
- Para probar sin tocar los datos reales: `node scripts/prueba.mjs copiar`, luego `node scripts/prueba.mjs app` (puerto 3019) y al final `node scripts/prueba.mjs borrar`.

## Estructura

| Carpeta | Qué contiene |
|---|---|
| `app/login`, `app/cambiar-clave` | Entrada y cambio de contraseña (sin menú) |
| `app/(sistema)/…` | Pantallas con menú; cada una exige su permiso |
| `servidor/` | Acciones del servidor por módulo (ventas, pedidos, libro, configuración, sesión). Todas verifican sesión, permiso y que el registro sea de la empresa activa (`servidor/comun.js`) |
| `lib/` | Base de datos, sesión, permisos (`permisos.js` define módulos y roles), fechas en hora de Colombia, formato |
| `components/` | `marco/` (menú, selector de empresa), `formularios/`, `ui/` |
| `supabase/migrations/` | Esquema y datos base: los mismos archivos que se subirán a Supabase |
| `supabase/local/` | Lo que en local imita a Supabase (usuarios `auth.users`, `auth.uid()`, roles). **No** se sube |
| `supabase/pruebas/` | Pruebas del esquema (`cd supabase/pruebas && npm i && npm test`) |
| `scripts/` | Base local (`db.mjs`), importación de las hojas, copia de prueba |

## En la nube (GitHub + Supabase + Vercel)

- **Código:** repositorio privado en GitHub. Cada cambio que se sube a `main` lo publica Vercel solo.
- **Base de datos:** Supabase. La app no usa Supabase Auth: los usuarios están en la tabla `usuarios` y la app maneja su propio inicio de sesión.
- **Variables en Vercel** (Settings → Environment Variables): `DATABASE_URL` (Supabase → Connect → *Transaction pooler*, puerto 6543) y `SESSION_SECRET` (ver `.env.example`).

Subir la base a Supabase desde el Mac (archivo `.env.nube.local` con `NUBE_DATABASE_URL=` la conexión *Session pooler*, puerto 5432; ese archivo no va al repositorio):

```bash
node scripts/nube.mjs probar     # prueba la conexión
node scripts/nube.mjs migrar     # crea las tablas
node scripts/nube.mjs copiar     # copia todos los datos del Mac y verifica que cuadren
node scripts/nube.mjs respaldo   # descarga una copia de los datos de la nube a respaldos/
```

Recomendado en Supabase: Settings → API → desactivar la *Data API* (la app no la usa).
