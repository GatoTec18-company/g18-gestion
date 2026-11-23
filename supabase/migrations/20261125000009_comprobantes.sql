-- =====================================================================
-- Comprobantes: fotos o PDF de facturas, transferencias y recibos
-- Se guardan en la misma base (comprimidos en el navegador antes de subir).
-- =====================================================================
create table comprobantes (
  id             uuid primary key default gen_random_uuid(),
  empresa_id     uuid not null references empresas(id) on delete cascade,
  movimiento_id  uuid references movimientos(id) on delete cascade,
  pedido_id      uuid references pedidos(id) on delete cascade,
  venta_id       uuid references ventas(id) on delete cascade,
  factura_id     uuid references facturas_proveedor(id) on delete cascade,
  nombre         text not null,
  tipo           text not null check (tipo in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  tamano         int not null check (tamano > 0 and tamano <= 3145728),
  datos          bytea not null,
  subido_por     uuid references usuarios(id) default auth.uid(),
  creado_en      timestamptz not null default now(),
  check (num_nonnulls(movimiento_id, pedido_id, venta_id, factura_id) = 1)
);
create index comprobantes_mov_idx on comprobantes (movimiento_id) where movimiento_id is not null;
create index comprobantes_ped_idx on comprobantes (pedido_id) where pedido_id is not null;
create index comprobantes_ven_idx on comprobantes (venta_id) where venta_id is not null;
create index comprobantes_fac_idx on comprobantes (factura_id) where factura_id is not null;

alter table comprobantes enable row level security;
create policy comprobantes_todo on comprobantes for all to authenticated
  using (es_miembro(empresa_id)) with check (es_miembro(empresa_id));
