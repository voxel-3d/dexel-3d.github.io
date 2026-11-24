-- Run after catalog/google-drive/migration.sql.
begin;
alter table public.models drop constraint if exists model_stl_path;
alter table public.models add constraint model_stl_path check (
  stl_path ~ ('^' || user_id::text || '/' || id::text || '/([0-9a-f-]{36}[.]stl|drive-[A-Za-z0-9_-]{10,160}[.](stl|3mf))$')
);
notify pgrst, 'reload schema';
commit;
