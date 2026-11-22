begin;

alter table public.models add column if not exists geometry_metrics jsonb;
grant insert (geometry_metrics), update (geometry_metrics) on public.models to authenticated;

commit;
