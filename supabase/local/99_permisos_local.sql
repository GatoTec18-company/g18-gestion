-- Supabase da estos permisos solo; en local se aplican después de cada migración.
-- La seguridad real la ponen las políticas RLS de cada tabla.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated, service_role;
grant usage, select on all sequences in schema public to authenticated, service_role;
grant execute on all functions in schema public to authenticated, service_role;
