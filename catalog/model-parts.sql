begin;
alter table public.models add column if not exists stl_files jsonb
  check (stl_files is null or jsonb_typeof(stl_files) = 'array');
grant insert (stl_files), update (stl_files), select (stl_files) on public.models to authenticated;
grant select (stl_files) on public.models to anon;
drop trigger if exists dexel_model_parts_metadata on public.models;
create trigger dexel_model_parts_metadata before update of stl_files
on public.models for each row execute function public.set_dexel_model_metadata();
notify pgrst, 'reload schema';
commit;
