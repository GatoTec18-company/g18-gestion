-- =====================================================================
-- Datos base tomados de los Google Sheets actuales
-- (configuración, no movimientos: el histórico se importa aparte)
-- =====================================================================

insert into empresas (id, nombre) values
  ('00000000-0000-0000-0000-000000000018', 'G18 Corporation SAS'),
  ('00000000-0000-0000-0000-000000000118', 'Gatotec 18');

-- Festivos de Colombia (para la regla de días hábiles de la tarjeta)
insert into festivos (fecha, nombre) values
  ('2026-01-01','Año Nuevo'), ('2026-01-12','Reyes Magos'), ('2026-03-23','San José'),
  ('2026-04-02','Jueves Santo'), ('2026-04-03','Viernes Santo'), ('2026-05-01','Día del Trabajo'),
  ('2026-05-18','Ascensión'), ('2026-06-08','Corpus Christi'), ('2026-06-15','Sagrado Corazón'),
  ('2026-06-29','San Pedro y San Pablo'), ('2026-07-20','Independencia'), ('2026-08-07','Batalla de Boyacá'),
  ('2026-08-17','Asunción'), ('2026-10-12','Día de la Raza'), ('2026-11-02','Todos los Santos'),
  ('2026-11-16','Independencia de Cartagena'), ('2026-12-08','Inmaculada Concepción'), ('2026-12-25','Navidad'),
  ('2027-01-01','Año Nuevo'), ('2027-01-11','Reyes Magos'), ('2027-03-22','San José'),
  ('2027-03-25','Jueves Santo'), ('2027-03-26','Viernes Santo'), ('2027-05-01','Día del Trabajo'),
  ('2027-05-10','Ascensión'), ('2027-05-31','Corpus Christi'), ('2027-06-07','Sagrado Corazón'),
  ('2027-07-05','San Pedro y San Pablo'), ('2027-07-20','Independencia'), ('2027-08-07','Batalla de Boyacá'),
  ('2027-08-16','Asunción'), ('2027-10-18','Día de la Raza'), ('2027-11-01','Todos los Santos'),
  ('2027-11-15','Independencia de Cartagena'), ('2027-12-08','Inmaculada Concepción'), ('2027-12-25','Navidad');

-- Configuración igual para las dos empresas
do $$
declare e uuid;
begin
  foreach e in array array['00000000-0000-0000-0000-000000000018'::uuid, '00000000-0000-0000-0000-000000000118'::uuid] loop

    insert into cuentas (empresa_id, nombre, tipo) values
      (e, 'Efectivo',   'efectivo'),
      (e, 'Caja menor', 'caja_menor'),
      (e, 'Bancos',     'banco'),
      (e, 'Daviplata',  'billetera'),
      (e, 'Nequi',      'billetera');

    insert into bolsillos (empresa_id, codigo, nombre, porcentaje, orden) values
      (e, '75',  'Proveedores',  75, 1),
      (e, '10A', 'Gastos fijos', 10, 2),
      (e, '10B', 'Deuda',        10, 3),
      (e, '5',   'Ahorro',        5, 4);

    insert into categorias_gasto (empresa_id, nombre, tipo, guia) values
      (e, 'Proveedores (abonos y pagos)', 'proveedores',         'Pagos y abonos a proveedores con cuenta (Fernando, Jaltech, SED, TM…). Elige el proveedor en el campo Tercero.'),
      (e, 'Mercancía para vender',        'proveedores',         'Inventario que compras para tener en stock y vender después.'),
      (e, 'Pedidos de clientes',          'proveedores',         'Lo que compras porque un cliente ya lo pidió. Es costo de venta: liga el gasto al pedido.'),
      (e, 'Nómina y personal',            'nomina',              'Sueldos, adelantos y pagos al personal.'),
      (e, 'Deuda y financieros',          'deuda_financieros',   'Cuotas de crédito y pagos financieros.'),
      (e, 'Software y marketing',         'gasto_fijo',          'Software, pauta, publicidad.'),
      (e, 'Fletes y envíos',              'gasto_variable',      'Fletes, domicilios y envíos.'),
      (e, 'Local y mobiliario',           'inversion',           'Adecuaciones y muebles del local.'),
      (e, 'Vehículo',                     'gasto_variable',      'Gasolina, viáticos y mantenimiento.'),
      (e, 'Contador',                     'gasto_fijo',          'Honorarios del contador.'),
      (e, 'Impuestos y bancarios',        'impuestos_bancarios', '4x1000, cuotas de manejo e impuestos.'),
      (e, 'Equipos y activos',            'inversion',           'Equipos que se quedan en el negocio (incluye compras de Amazon para la empresa).'),
      (e, 'Otros y ajustes',              'otros',               'Imprevistos y ajustes de caja.'),
      (e, 'Arriendo y servicios',         'gasto_fijo',          'Arriendo, luz, agua, internet, aseo, seguridad.');

    insert into entidades_financiacion (empresa_id, nombre, regla, valor, dia_corte, nota) values
      (e, 'Addi',               'dias_calendario', 7,  null, 'Addi tarda unos 7 días.'),
      (e, 'Sumas Pay',          'dia_fijo_mes',    10, 25,   'Paga el 10 del mes siguiente; desde el día 25 cuenta como venta del mes siguiente.'),
      (e, 'Cooperativa',        'sin_fecha',       null, null, 'Sin fecha fija: anotar la fecha cuando se sepa.'),
      (e, 'Tarjeta de crédito', 'dias_habiles',    1,  null, 'Un día hábil después; no paga sábados, domingos ni festivos.');

    insert into terceros (empresa_id, nombre, es_proveedor, cupo_credito) values
      (e, 'Fernando',   true, 0),
      (e, 'TM',         true, 3000000),
      (e, 'Jaltech',    true, 4000000),
      (e, 'MPS',        true, 0),
      (e, 'Giftronic',  true, 80000000),
      (e, 'Tecnosys',   true, null),
      (e, 'SED',        true, null),
      (e, 'Unitec',     true, null),
      (e, 'Amazon',     true, null);
  end loop;
end $$;

-- Gastos fijos de G18 Corporation SAS (CRONOGRAMA DE PAGOS, noviembre 2026)
insert into gastos_fijos (empresa_id, concepto, dia_pago, monto_previsto, categoria_id, bolsillo_id)
select '00000000-0000-0000-0000-000000000018', g.concepto, g.dia, g.monto,
       (select id from categorias_gasto where empresa_id = '00000000-0000-0000-0000-000000000018' and nombre = g.categoria),
       (select id from bolsillos        where empresa_id = '00000000-0000-0000-0000-000000000018' and codigo = '10A')
from (values
  ('Arriendo',                 5,    3560000, 'Arriendo y servicios'),
  ('Luz',                      2,     780000, 'Arriendo y servicios'),
  ('Agua',                     12,     50000, 'Arriendo y servicios'),
  ('Internet',                 5,      90000, 'Arriendo y servicios'),
  ('Nómina Yolman Contreras',  30,   5000000, 'Nómina y personal'),
  ('Nómina Mónica Corzo',      21,   5000000, 'Nómina y personal'),
  ('Software (prorrateado)',   25,     55000, 'Software y marketing'),
  ('Contador',                 20,    400000, 'Contador'),
  ('Grupo WAC',                15,    800000, 'Otros y ajustes'),
  ('Pauta',                    null,  300000, 'Software y marketing'),
  ('Seller Chat',              null,  100000, 'Software y marketing'),
  ('Meta Business',            null,   65000, 'Software y marketing'),
  ('Vitrina comercial',        null,  300000, 'Software y marketing'),
  ('Aseo',                     22,    100000, 'Arriendo y servicios')
) as g(concepto, dia, monto, categoria);

insert into metas_mes (empresa_id, mes, meta_ventas) values
  ('00000000-0000-0000-0000-000000000018', '2026-11-01', 50000000);
