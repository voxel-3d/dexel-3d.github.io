begin;

alter table public.models add column if not exists geometry_metrics jsonb;
grant insert (geometry_metrics), update (geometry_metrics) on public.models to authenticated;

-- Built-in catalog overrides use the same shape when the admin migration is installed.
alter table if exists public.catalog_builtin_models add column if not exists geometry_metrics jsonb;

notify pgrst, 'reload schema';
commit;
